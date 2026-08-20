import assert from "node:assert/strict"
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import type { ToolContext } from "@opencode-ai/plugin"
import { authorizeImagePaths } from "../src/index.js"
import { detectImageDimensions, detectMime, formatImageMetadata, viewImages } from "../src/view.js"

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
})
