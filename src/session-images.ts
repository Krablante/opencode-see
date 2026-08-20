import type { PluginInput } from "@opencode-ai/plugin"
import { MAX_IMAGES, SUPPORTED_IMAGE_MIMES, type SupportedImageMime } from "./constants.js"
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
}): Promise<SessionImage[]> {
  let messages = await sessionMessages(input.client, input.sessionID, input.source === "latest" ? LATEST_HISTORY_LIMIT : undefined)
  let groups = imageGroups(messages)
  let images = input.source === "latest" ? latestImages(groups) : newestSessionImages(groups)

  if (input.source === "latest" && images.length === 0 && messages.length === LATEST_HISTORY_LIMIT) {
    messages = await sessionMessages(input.client, input.sessionID)
    groups = imageGroups(messages)
    images = latestImages(groups)
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
  limit?: number,
): Promise<unknown[]> {
  const response = await client.session.messages({
    path: { id: sessionID },
    ...(limit === undefined ? {} : { query: { limit } }),
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

function prepareCandidates(candidates: ImageCandidate[]): SessionImage[] {
  const images: SessionImage[] = []
  for (const candidate of candidates) {
    const bytes = decodeDataUrl(candidate.url)
    if (!bytes) continue
    try {
      const prepared = prepareImage(bytes, candidate.filename ?? "session-image")
      images.push({ ...prepared, origin: candidate.origin })
    } catch {
      // Session history can contain malformed or mislabeled files. Ignore them as unsupported.
    }
  }
  return images
}

function decodeDataUrl(url: string): Buffer | undefined {
  const comma = url.indexOf(",")
  if (comma < 0 || !url.slice(0, comma).toLowerCase().endsWith(";base64")) return
  const encoded = url.slice(comma + 1)
  if (encoded.length === 0) return
  try {
    return Buffer.from(encoded, "base64")
  } catch {
    return
  }
}

function latestImages(groups: ImageCandidate[][]): SessionImage[] {
  for (let index = groups.length - 1; index >= 0; index--) {
    const images = unique(prepareCandidates(groups[index] ?? [])).slice(0, MAX_IMAGES)
    if (images.length > 0) return images
  }
  return []
}

function newestSessionImages(groups: ImageCandidate[][]): SessionImage[] {
  const images: SessionImage[] = []
  const seen = new Set<string>()
  for (let index = groups.length - 1; index >= 0 && images.length < MAX_IMAGES; index--) {
    for (const candidate of groups[index] ?? []) {
      if (seen.has(candidate.url)) continue
      seen.add(candidate.url)
      const image = prepareCandidates([candidate])[0]
      if (!image) continue
      images.push(image)
      if (images.length === MAX_IMAGES) break
    }
  }
  return images
}

function unique(images: SessionImage[]): SessionImage[] {
  const seen = new Set<string>()
  return images.filter((image) => {
    if (seen.has(image.dataUrl)) return false
    seen.add(image.dataUrl)
    return true
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
