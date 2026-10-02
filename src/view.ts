import type { ToolContext } from "@opencode-ai/plugin"
import { readFile, realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import {
  CORE_RESIZE_BASE64_BYTES,
  CORE_RESIZE_DIMENSION,
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  type SupportedImageMime,
} from "./constants.js"

export type ImageDimensions = { width: number; height: number }

export type PreparedImage = ImageDimensions & {
  filename: string
  mime: SupportedImageMime
  size: number
  dataUrl: string
  willBeResizedByCore: boolean
}

export type ViewedImage = PreparedImage & { path: string }

export type ViewImagesOptions = {
  paths: string[]
  directory: string
  authorize: (paths: string[]) => Promise<void>
  home?: string
  signal?: AbortSignal
}

function containsPath(root: string, target: string): boolean {
  const distance = relative(resolve(root), resolve(target))
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance))
}

export async function authorizeImagePaths(context: ToolContext, paths: string[]): Promise<void> {
  const externalPatterns = [
    ...new Set(
      paths
        .filter((path) => !containsPath(context.worktree, path))
        .map((path) => join(dirname(path), "*").replaceAll("\\", "/")),
    ),
  ]
  if (externalPatterns.length > 0) {
    await context.ask({
      permission: "external_directory",
      patterns: externalPatterns,
      always: externalPatterns,
      metadata: { paths },
    })
  }
  const readPatterns = paths.map((path) => relative(context.worktree, path).replaceAll("\\", "/"))
  await context.ask({ permission: "read", patterns: readPatterns, always: readPatterns, metadata: { paths } })
}

export function expandHome(value: string, home: string = homedir()): string {
  if (value === "~") return home
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(home, value.slice(2))
  return value
}

export function resolveImagePath(value: string, directory: string, home: string = homedir()): string {
  const expanded = expandHome(value, home)
  return resolve(isAbsolute(expanded) ? expanded : resolve(directory, expanded))
}

export function detectMime(bytes: Buffer): SupportedImageMime | undefined {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    return "image/webp"
  }
  if (bytes.length >= 6) {
    const signature = bytes.toString("ascii", 0, 6)
    if (signature === "GIF87a" || signature === "GIF89a") return "image/gif"
  }
  return undefined
}

function jpegDimensions(bytes: Buffer): ImageDimensions | undefined {
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return undefined
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return undefined
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isStartOfFrame && length >= 7) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  return undefined
}

function readUInt24LE(bytes: Buffer, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function webpDimensions(bytes: Buffer): ImageDimensions | undefined {
  if (bytes.length < 25) return undefined
  const chunk = bytes.toString("ascii", 12, 16)
  if (chunk === "VP8X" && bytes.length >= 30) {
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 }
  }
  if (chunk === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  return undefined
}

export function detectImageDimensions(bytes: Buffer, mime: SupportedImageMime): ImageDimensions {
  let dimensions: ImageDimensions | undefined
  if (mime === "image/png" && bytes.length >= 24) {
    dimensions = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
  } else if (mime === "image/gif" && bytes.length >= 10) {
    dimensions = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) }
  } else if (mime === "image/jpeg") {
    dimensions = jpegDimensions(bytes)
  } else if (mime === "image/webp") {
    dimensions = webpDimensions(bytes)
  }
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) {
    throw new Error(`Could not read ${mime} image dimensions`)
  }
  return dimensions
}

async function resolveExistingFile(value: string, directory: string, home?: string): Promise<string> {
  const requested = resolveImagePath(value, directory, home)
  try {
    return await realpath(requested)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new Error(`Image does not exist: ${requested}`)
    throw error
  }
}

export function prepareImage(bytes: Buffer, filename: string, encoded?: string): PreparedImage {
  if (bytes.length === 0) throw new Error(`Image is empty: ${filename}`)
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`Image exceeds the 20 MiB limit: ${filename}`)
  const mime = detectMime(bytes)
  if (!mime) throw new Error(`Unsupported image format: ${filename}. Use PNG, JPEG, WebP, or GIF.`)
  const dimensions = detectImageDimensions(bytes, mime)
  const base64 = encoded ?? bytes.toString("base64")
  return {
    filename,
    mime,
    size: bytes.length,
    ...dimensions,
    dataUrl: `data:${mime};base64,${base64}`,
    willBeResizedByCore:
      dimensions.width > CORE_RESIZE_DIMENSION ||
      dimensions.height > CORE_RESIZE_DIMENSION ||
      base64.length > CORE_RESIZE_BASE64_BYTES,
  }
}

async function loadImage(path: string, signal?: AbortSignal): Promise<ViewedImage> {
  signal?.throwIfAborted()
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`Image is not a regular file: ${path}`)
  if (info.size > MAX_IMAGE_BYTES) throw new Error(`Image exceeds the 20 MiB limit: ${path}`)
  const bytes = await readFile(path, { signal })
  return {
    path,
    ...prepareImage(bytes, basename(path)),
  }
}

export async function viewImages(options: ViewImagesOptions): Promise<ViewedImage[]> {
  options.signal?.throwIfAborted()
  if (options.paths.length < 1 || options.paths.length > MAX_IMAGES) {
    throw new Error(`image_view requires between 1 and ${MAX_IMAGES} paths`)
  }
  const resolved = await Promise.all(
    options.paths.map((path) => resolveExistingFile(path, options.directory, options.home)),
  )
  if (new Set(resolved).size !== resolved.length) throw new Error("Image paths must be unique")
  await options.authorize(resolved)
  const images: ViewedImage[] = []
  for (const path of resolved) images.push(await loadImage(path, options.signal))
  return images
}

export function formatImageMetadata(images: ViewedImage[]): string {
  return [
    "Image metadata:",
    ...images.map(
      (image, index) =>
        `${index + 1}. path=${image.path} | mime=${image.mime} | bytes=${image.size} | dimensions=${image.width}×${image.height} | core_resize=${image.willBeResizedByCore ? "yes" : "no"}`,
    ),
  ].join("\n")
}
