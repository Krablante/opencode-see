import assert from "node:assert/strict"
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { CaptureUnavailableError, captureScreenshot, findChromium, isSnapChromium } from "../src/capture.js"
import type { SeeConfig } from "../src/config.js"

const config: SeeConfig = {
  screenshotDirectory: ".opencode/screenshots",
  screenshotRoot: "/tmp/opencode-see-test-output",
  viewport: { width: 800, height: 600 },
  virtualTimeBudgetMs: 1,
  screenshotTimeoutMs: 1000,
  visionDelegate: {
    enabled: true,
    model: "opencode-go/gpt-5.6-luna",
    providerID: "opencode-go",
    modelID: "gpt-5.6-luna",
    prompt: "Describe the image.",
    timeoutMs: 100,
    deleteAfter: true,
  },
  configPath: "/tmp/opencode-see.json",
}

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

async function fakeBrowser(name = "fake-chrome", hang = false): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "opencode-see-browser-"))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, `#!/usr/bin/env node
const fs = require("node:fs")
fs.appendFileSync(${JSON.stringify(join(root, "launch.log"))}, JSON.stringify({ pid: process.pid, args: process.argv }) + "\\n")
${hang ? "setInterval(() => {}, 1000)" : `
const screenshot = process.argv.find((arg) => arg.startsWith("--screenshot="))
if (!screenshot) process.exit(2)
fs.writeFileSync(screenshot.slice("--screenshot=".length), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+X1dWAAAAAElFTkSuQmCC", "base64"))
`}
`)
  await chmod(path, 0o755)
  return { root, path }
}

describe("browser discovery", () => {
  it("returns no browser when no configured executable or PATH candidate exists", async () => {
    const found = await findChromium(undefined, { PATH: "" }, "/nonexistent", "win32")
    assert.equal(found, undefined)
  })

  it("returns an actionable result instead of failing silently when Chromium is absent", async () => {
    await assert.rejects(
      captureScreenshot({
        url: "http://localhost/",
        config,
        env: { PATH: "" },
        home: "/nonexistent",
        platform: "win32",
      }),
      (error: unknown) => error instanceof CaptureUnavailableError && /Install Microsoft Edge or Google Chrome/.test(error.message),
    )
  })

  it("recognizes snap launchers", () => {
    assert.equal(isSnapChromium("/usr/bin/chromium-browser"), true)
    assert.equal(isSnapChromium("/snap/bin/chromium"), true)
    assert.equal(isSnapChromium("/usr/bin/google-chrome"), false)
  })

  it("does not substitute another browser for a broken explicit override", async () => {
    const fake = await fakeBrowser("google-chrome")
    assert.equal(await findChromium(join(fake.root, "missing"), { PATH: fake.root }, fake.root, "linux"), undefined)
  })
})

describe("capture validation", () => {
  it("rejects non-http URLs before looking for a browser", async () => {
    await assert.rejects(
      captureScreenshot({ url: "file:///etc/passwd", config, env: { PATH: "" }, platform: "win32" }),
      /http:\/\/ and https:\/\//,
    )
  })

  it("rejects invalid viewport dimensions", async () => {
    await assert.rejects(
      captureScreenshot({ url: "http://localhost/", width: 0, config, env: { PATH: "" }, platform: "win32" }),
      /positive integers/,
    )
  })

  it("rejects a viewport whose allocation would be unbounded", async () => {
    await assert.rejects(captureScreenshot({ url: "http://localhost/", width: 100000, height: 100000, config }), /32 megapixel/)
  })

  it("falls back to the Chromium CLI when CDP fails for an ordinary executable", async () => {
    const fake = await fakeBrowser()
    const result = await captureScreenshot({
      url: "http://localhost/",
      outputPath: "fallback.png",
      config: { ...config, screenshotRoot: fake.root, chromiumPath: fake.path },
      env: { PATH: process.env.PATH },
      platform: "linux",
    })
    assert.equal(result.backend, "cli")
    assert.equal(result.absolutePath, join(fake.root, "fallback.png"))
    assert.ok(result.bytes.length > 0)
  })

  it("does not use the CLI fallback for a snap Chromium launcher", async () => {
    const fake = await fakeBrowser("chromium-browser")
    await assert.rejects(
      captureScreenshot({
        url: "http://localhost/",
        outputPath: "snap.png",
        config: { ...config, screenshotRoot: fake.root, chromiumPath: fake.path },
        env: { PATH: process.env.PATH, SNAP_USER_COMMON: fake.root },
        platform: "linux",
      }),
      /CLI fallback is disabled because snap has a private \/tmp/,
    )
  })

  it("preserves existing output files", async () => {
    const fake = await fakeBrowser()
    const path = join(fake.root, "existing.png")
    await writeFile(path, "original")
    await assert.rejects(captureScreenshot({ url: "http://localhost/", outputPath: "existing.png", config: { ...config, screenshotRoot: fake.root, chromiumPath: fake.path } }), /already exists/)
    assert.equal(await readFile(path, "utf8"), "original")
    await assert.rejects(access(join(fake.root, "launch.log")))
  })

  it("rejects lexical and symlink escapes without creating directories outside the root", async () => {
    const fake = await fakeBrowser()
    const root = join(fake.root, "screenshots")
    const outside = join(fake.root, "outside")
    await mkdir(root)
    await mkdir(outside)
    await symlink(outside, join(root, "alias"))
    const options = { url: "http://localhost/", config: { ...config, screenshotRoot: root, chromiumPath: fake.path } }
    await assert.rejects(captureScreenshot({ ...options, outputPath: "../escape.png" }), /escapes/)
    await assert.rejects(captureScreenshot({ ...options, outputPath: "alias/sub/escape.png" }), /symlink/)
    await assert.rejects(access(join(outside, "sub")))
  })

  it("stops and cleans a timed-out CDP process without launching fallback", async () => {
    const fake = await fakeBrowser("fake-chrome", true)
    await assert.rejects(captureScreenshot({ url: "http://localhost/", config: { ...config, screenshotTimeoutMs: 200, screenshotRoot: fake.root, chromiumPath: fake.path } }), /timed out/)
    const launches = (await readFile(join(fake.root, "launch.log"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { pid: number; args: string[] })
    assert.equal(launches.length, 1)
    const profile = launches[0].args.find((arg) => arg.startsWith("--user-data-dir="))!.split("=")[1]
    await assert.rejects(access(profile))
    assert.throws(() => process.kill(launches[0].pid, 0), { code: "ESRCH" })
  })
})
