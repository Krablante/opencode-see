import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { CaptureUnavailableError, captureScreenshot, cliScratchPath, findChromium, isSnapChromium } from "../src/capture.js"
import type { SeeConfig } from "../src/config.js"

const config: SeeConfig = {
  screenshotDirectory: ".opencode/screenshots",
  screenshotRoot: "/tmp/opencode-see-test-output",
  viewport: { width: 800, height: 600 },
  virtualTimeBudgetMs: 1,
  screenshotTimeoutMs: 100,
  configPath: "/tmp/opencode-see.json",
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
})
