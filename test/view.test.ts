import assert from "node:assert/strict"
import { mkdtemp, mkdir, open, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import { viewSessionImages } from "../src/session-images.js"
import { MAX_IMAGE_BYTES } from "../src/constants.js"
import { authorizeImagePaths, detectImageDimensions, detectMime, formatImageMetadata, viewImages } from "../src/view.js"

const roots: string[] = []
afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
}

function gif(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(10)
  bytes.write("GIF89a", 0, "ascii")
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  return bytes
}

function webp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30)
  bytes.write("RIFF", 0, "ascii")
  bytes.writeUInt32LE(22, 4)
  bytes.write("WEBP", 8, "ascii")
  bytes.write("VP8X", 12, "ascii")
  bytes.writeUInt32LE(10, 16)
  bytes.writeUIntLE(width - 1, 24, 3)
  bytes.writeUIntLE(height - 1, 27, 3)
  return bytes
}

describe("image formats", () => {
  for (const [mime, bytes, dimensions] of [
    ["image/png", png(321, 123), { width: 321, height: 123 }],
    ["image/jpeg", jpeg(640, 480), { width: 640, height: 480 }],
    ["image/gif", gif(90, 45), { width: 90, height: 45 }],
    ["image/webp", webp(800, 600), { width: 800, height: 600 }],
  ] as const) {
    it(`detects ${mime} by signature and reads dimensions`, () => {
      assert.equal(detectMime(bytes), mime)
      assert.deepEqual(detectImageDimensions(bytes, mime), dimensions)
    })
  }

  it("rejects unsupported signatures", () => {
    assert.equal(detectMime(Buffer.from("not an image")), undefined)
  })

  it("reads a short lossless WebP header", () => {
    const bytes = Buffer.alloc(25)
    bytes.write("RIFF", 0)
    bytes.write("WEBPVP8L", 8)
    bytes[20] = 0x2f
    bytes.writeUInt32LE((7 << 14) | 11, 21)
    assert.deepEqual(detectImageDimensions(bytes, "image/webp"), { width: 12, height: 8 })
  })
})

describe("viewImages", () => {
  it("resolves project-relative, absolute, and home-relative paths before one authorization call", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-see-view-"))
    roots.push(root)
    const home = join(root, "home")
    const project = join(root, "project")
    await mkdir(home)
    await mkdir(project)
    const projectImage = join(project, "project.png")
    const homeImage = join(home, "home.gif")
    const absoluteImage = join(project, "absolute.webp")
    await writeFile(projectImage, png(100, 50))
    await writeFile(homeImage, gif(20, 10))
    await writeFile(absoluteImage, webp(40, 30))
    const calls: string[][] = []
    const images = await viewImages({
      paths: ["project.png", "~/home.gif", absoluteImage],
      directory: project,
      home,
      authorize: async (paths) => { calls.push(paths) },
    })
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0], [projectImage, homeImage, absoluteImage])
    assert.deepEqual(images.map(({ mime, width, height }) => ({ mime, width, height })), [
      { mime: "image/png", width: 100, height: 50 },
      { mime: "image/gif", width: 20, height: 10 },
      { mime: "image/webp", width: 40, height: 30 },
    ])
    assert.match(formatImageMetadata(images), /Image metadata:/)
    assert.match(formatImageMetadata(images), /dimensions=100×50/)
  })

  it("resolves a symlink before authorization so an external target cannot bypass permission", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-see-link-"))
    roots.push(root)
    const project = join(root, "project")
    const outside = join(root, "outside")
    await mkdir(project)
    await mkdir(outside)
    const target = join(outside, "image.png")
    await writeFile(target, png(12, 8))
    await symlink(target, join(project, "link.png"))
    let authorized: string[] = []
    await viewImages({
      paths: ["link.png"],
      directory: project,
      authorize: async (paths) => { authorized = paths },
    })
    assert.deepEqual(authorized, [target])
  })

  it("limits each call to five unique images", async () => {
    await assert.rejects(
      viewImages({ paths: [], directory: "/", authorize: async () => {} }),
      /between 1 and 5/,
    )
    await assert.rejects(
      viewImages({ paths: Array(6).fill("x.png"), directory: "/", authorize: async () => {} }),
      /between 1 and 5/,
    )
  })

  it("rejects oversized files before reading their content", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-see-large-"))
    roots.push(root)
    const file = await open(join(root, "large.png"), "w")
    await file.truncate(MAX_IMAGE_BYTES + 1)
    await file.close()
    await assert.rejects(viewImages({ paths: ["large.png"], directory: root, authorize: async () => {} }), /20 MiB limit/)
  })
})

describe("OpenCode permissions", () => {
  it("asks external_directory before read for a path outside the worktree", async () => {
    const calls: Array<{ permission: string; patterns: string[] }> = []
    const context = {
      worktree: "/workspace/project",
      directory: "/workspace/project",
      ask: async (request: { permission: string; patterns: string[] }) => { calls.push(request) },
    } as unknown as ToolContext
    await authorizeImagePaths(context, ["/workspace/project/inside.png", "/home/me/outside.png"])
    assert.deepEqual(calls.map((call) => call.permission), ["external_directory", "read"])
    assert.deepEqual(calls[0].patterns, ["/home/me/*"])
    assert.deepEqual(calls[1].patterns, ["inside.png", "../../home/me/outside.png"])
  })

  it("asks only read for paths inside the worktree", async () => {
    const calls: Array<{ permission: string }> = []
    const context = {
      worktree: "/workspace/project",
      directory: "/workspace/project",
      ask: async (request: { permission: string }) => { calls.push(request) },
    } as unknown as ToolContext
    await authorizeImagePaths(context, ["/workspace/project/image.png"])
    assert.deepEqual(calls.map((call) => call.permission), ["read"])
  })

  it("does not mistake a dot-prefixed child for a parent traversal", async () => {
    const calls: string[] = []
    const context = { worktree: "/workspace", ask: async (request: { permission: string }) => { calls.push(request.permission) } } as unknown as ToolContext
    await authorizeImagePaths(context, ["/workspace/..preview/image.png"])
    assert.deepEqual(calls, ["read"])
  })
})

describe("session images", () => {
  function message(id: number, images = 1) {
    return { info: { role: "user" }, parts: Array.from({ length: images }, (_, index) => ({
      type: "file", mime: "image/jpeg", filename: `${id}-${index}.png`,
      url: `data:image/jpeg;base64,${png(id + index + 1, 2).toString("base64")}`,
    })) }
  }

  function client(history: unknown[], calls: number[]) {
    return { session: { messages: async (input: { query: { limit: number } }) => {
      calls.push(input.query.limit)
      return { data: history.slice(-input.query.limit) }
    } } } as unknown as PluginInput["client"]
  }

  it("takes the latest batch in order, caps it at five and detects MIME from bytes", async () => {
    const calls: number[] = []
    const images = await viewSessionImages({ client: client([message(1), message(10, 8)], calls), sessionID: "s", source: "latest" })
    assert.deepEqual(images.map((image) => image.filename), ["10-0.png", "10-1.png", "10-2.png", "10-3.png", "10-4.png"])
    assert.equal(images[0].mime, "image/png")
    assert.deepEqual(calls, [64])
  })

  it("finds five recent unique images without loading a long full history", async () => {
    const calls: number[] = []
    const history = Array.from({ length: 500 }, (_, index) => message(index))
    const images = await viewSessionImages({ client: client(history, calls), sessionID: "s", source: "session" })
    assert.deepEqual(images.map((image) => image.filename), ["499-0.png", "498-0.png", "497-0.png", "496-0.png", "495-0.png"])
    assert.deepEqual(calls, [64])
  })

  it("expands the window only when older images are needed", async () => {
    const calls: number[] = []
    const history = [message(1), ...Array.from({ length: 70 }, () => ({ info: { role: "assistant" }, parts: [] }))]
    const images = await viewSessionImages({ client: client(history, calls), sessionID: "s", source: "latest" })
    assert.equal(images[0].filename, "1-0.png")
    assert.deepEqual(calls, [64, 128])
  })

  it("ignores malformed data and remote URLs and uses completed tool attachments", async () => {
    const attachment = message(5).parts[0]
    const history = [message(1), { info: { role: "assistant" }, parts: [
      { type: "tool", state: { status: "running", attachments: [message(10).parts[0]] } },
      { type: "tool", state: { status: "completed", attachments: [
        { ...attachment, url: "https://example.com/image.png" },
        { ...attachment, url: "data:image/png;base64,aGVsbG8=" }, attachment, attachment,
      ] } },
    ] }]
    const images = await viewSessionImages({ client: client(history, []), sessionID: "s", source: "latest" })
    assert.equal(images.length, 1)
    assert.equal(images[0].filename, "5-0.png")
    assert.equal(images[0].origin, "tool attachment")
  })
})
