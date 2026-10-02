import type { PluginInput } from "@opencode-ai/plugin"
import { MAX_IMAGES, MAX_IMAGE_BYTES, SUPPORTED_IMAGE_MIMES, type SupportedImageMime } from "./constants.js"
import { prepareImage, type PreparedImage } from "./view.js"

const LATEST_HISTORY_LIMIT = 64

export type SessionImageSource = "latest" | "session"
export type SessionImage = PreparedImage & { origin: "user attachment" | "tool attachment" }

type ImageCandidate = {
  url: string
  filename?: string
  origin: SessionImage["origin"]
}

export async function viewSessionImages(input: {
  client: PluginInput["client"]
  sessionID: string
  source: SessionImageSource
  signal?: AbortSignal
}): Promise<SessionImage[]> {
  let limit = LATEST_HISTORY_LIMIT
  let images: SessionImage[]
  while (true) {
    input.signal?.throwIfAborted()
    const messages = await sessionMessages(input.client, input.sessionID, limit, input.signal)
    images = selectImages(imageGroups(messages), input.source)
    if (messages.length < limit || images.length === MAX_IMAGES || (input.source === "latest" && images.length > 0)) break
    limit *= 2
  }

  if (images.length === 0) {
    throw new Error(
      input.source === "latest"
        ? "No supported image was found in the current session. Attach a PNG, JPEG, WebP, or GIF, or pass paths."
        : "No supported images were found in the current session. Attach PNG, JPEG, WebP, or GIF files, or pass paths.",
    )
  }
  return images
}

export function formatSessionImageMetadata(images: SessionImage[]): string {
  return [
    "Image metadata:",
    ...images.map(
      (image, index) =>
        `${index + 1}. source=${image.origin} | filename=${image.filename} | mime=${image.mime} | bytes=${image.size} | dimensions=${image.width}×${image.height} | core_resize=${image.willBeResizedByCore ? "yes" : "no"}`,
    ),
  ].join("\n")
}

async function sessionMessages(
  client: PluginInput["client"],
  sessionID: string,
  limit: number,
  signal?: AbortSignal,
): Promise<unknown[]> {
  const response = await client.session.messages({
    path: { id: sessionID },
    query: { limit },
    signal,
    throwOnError: true,
  })
  return Array.isArray(response.data) ? response.data : []
}

function imageGroups(messages: unknown[]): ImageCandidate[][] {
  const groups: ImageCandidate[][] = []
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.info) || !Array.isArray(message.parts)) continue

    if (message.info.role === "user") {
      const candidates = message.parts
        .filter((part) => isRecord(part) && part.type === "file")
        .map((part) => fileCandidate(part as Record<string, unknown>, "user attachment"))
        .filter((candidate): candidate is ImageCandidate => candidate !== undefined)
      if (candidates.length > 0) groups.push(candidates)
    }

    for (const part of message.parts) {
      if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state) || part.state.status !== "completed") continue
      if (!Array.isArray(part.state.attachments)) continue
      const candidates = part.state.attachments
        .map((attachment) => fileCandidate(attachment, "tool attachment"))
        .filter((candidate): candidate is ImageCandidate => candidate !== undefined)
      if (candidates.length > 0) groups.push(candidates)
    }
  }
  return groups
}

function fileCandidate(value: unknown, origin: ImageCandidate["origin"]): ImageCandidate | undefined {
  if (!isRecord(value) || typeof value.mime !== "string" || typeof value.url !== "string") return
  if (!SUPPORTED_IMAGE_MIMES.includes(value.mime as SupportedImageMime) || !value.url.startsWith("data:")) return
  return {
    url: value.url,
    filename: typeof value.filename === "string" && value.filename.length > 0 ? value.filename : undefined,
    origin,
  }
}

function prepareCandidate(candidate: ImageCandidate): SessionImage | undefined {
  const decoded = decodeDataUrl(candidate.url)
  if (!decoded) return
  try {
    const prepared = prepareImage(decoded.bytes, candidate.filename ?? "session-image", decoded.encoded)
    return { ...prepared, origin: candidate.origin }
  } catch {
    // Session history can contain malformed or oversized files. Ignore them as unsupported.
  }
}

function decodeDataUrl(url: string): { bytes: Buffer; encoded: string } | undefined {
  const comma = url.indexOf(",")
  if (comma < 0 || !url.slice(0, comma).toLowerCase().endsWith(";base64")) return
  const encoded = url.slice(comma + 1)
  if (encoded.length === 0 || encoded.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) return
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return
  try {
    return { bytes: Buffer.from(encoded, "base64"), encoded }
  } catch {
    return
  }
}

function selectImages(groups: ImageCandidate[][], source: SessionImageSource): SessionImage[] {
  const images: SessionImage[] = []
  const seen = new Set<string>()
  for (let index = groups.length - 1; index >= 0 && images.length < MAX_IMAGES; index--) {
    for (const candidate of groups[index] ?? []) {
      if (seen.has(candidate.url)) continue
      seen.add(candidate.url)
      const image = prepareCandidate(candidate)
      if (!image) continue
      images.push(image)
      if (images.length === MAX_IMAGES) break
    }
    if (source === "latest" && images.length > 0) return images
  }
  return images
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
