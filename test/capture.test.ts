import assert from "node:assert/strict"
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { CaptureUnavailableError, captureScreenshot, cliScratchPath, findChromium, isSnapChromium } from "../src/capture.js"
import type { SeeConfig } from "../src/config.js"

const config: SeeConfig = {
  screenshotDirectory: ".opencode/screenshots",
  screenshotRoot: "/tmp/opencode-see-test-output",
  viewport: { width: 800, height: 600 },
  virtualTimeBudgetMs: 1,
  screenshotTimeoutMs: 100,
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

async function fakeBrowser(name = "fake-chrome"): Promise<{ root: string; path: string }> {
  const root = await mkdtemp(join(tmpdir(), "opencode-see-browser-"))
  roots.push(root)
  const path = join(root, name)
  await writeFile(path, `#!/usr/bin/env node
const fs = require("node:fs")
const screenshot = process.argv.find((arg) => arg.startsWith("--screenshot="))
if (!screenshot) process.exit(2)
fs.writeFileSync(screenshot.slice("--screenshot=".length), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M/wHwAF/gL+X1dWAAAAAElFTkSuQmCC", "base64"))
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

  it("recognizes snap launchers and keeps CLI scratch data in snap-visible storage", () => {
    assert.equal(isSnapChromium("/usr/bin/chromium-browser"), true)
    assert.equal(isSnapChromium("/snap/bin/chromium"), true)
    assert.equal(isSnapChromium("/usr/bin/google-chrome"), false)
    assert.match(
      cliScratchPath("/tmp/final.png", "/snap/bin/chromium", "/home/user", {}),
      /^\/home\/user\/snap\/chromium\/common\/\.opencode-see-/,
    )
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
})
