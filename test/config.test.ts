import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, it } from "node:test"
import { defaultConfigPath, loadConfig } from "../src/config.js"

const roots: string[] = []
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))))

describe("config", () => {
  it("uses the portable project-relative defaults", async () => {
    const config = await loadConfig("/work/project", {}, "/home/test", "linux")
    assert.equal(config.screenshotRoot, "/work/project/.opencode/screenshots")
    assert.deepEqual(config.viewport, { width: 1440, height: 900 })
    assert.equal(config.virtualTimeBudgetMs, 2000)
    assert.equal(config.screenshotTimeoutMs, 30000)
    assert.deepEqual(config.visionDelegate, {
      enabled: true,
      providerID: "opencode-go",
      modelID: "gpt-5.6-luna",
      prompt: "Опиши содержимое каждой приложенной картинки подробно и по делу.",
      timeoutMs: 90000,
      deleteAfter: true,
    })
  })

  it("loads file values and lets environment variables override them", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-see-config-"))
    roots.push(root)
    const configDir = join(root, "config")
    await mkdir(configDir)
    await writeFile(join(configDir, "opencode-see.json"), JSON.stringify({
      screenshotDirectory: "~/Pictures/See",
      chromiumPath: "/file/chromium",
      viewport: { width: 1200, height: 700 },
      virtualTimeBudgetMs: 3000,
      screenshotTimeoutMs: 40000,
      visionDelegate: {
        enabled: false,
        providerID: "file-provider",
        modelID: "file-model",
        prompt: "File prompt",
        timeoutMs: 5000,
        deleteAfter: true,
      },
    }))
    const config = await loadConfig("/work/project", {
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_SEE_CHROMIUM: "/env/chromium",
      OPENCODE_SEE_VIEWPORT_WIDTH: "1600",
      OPENCODE_SEE_DELEGATE_ENABLED: "true",
      OPENCODE_SEE_DELEGATE_MODEL_ID: "env-model",
      OPENCODE_SEE_DELEGATE_PROMPT: "Env prompt",
      OPENCODE_SEE_DELEGATE_TIMEOUT_MS: "7000",
      OPENCODE_SEE_DELEGATE_DELETE_AFTER: "false",
    }, join(root, "home"), "linux")
    assert.equal(config.screenshotRoot, join(root, "home", "Pictures", "See"))
    assert.equal(config.chromiumPath, "/env/chromium")
    assert.deepEqual(config.viewport, { width: 1600, height: 700 })
    assert.equal(config.virtualTimeBudgetMs, 3000)
    assert.equal(config.screenshotTimeoutMs, 40000)
    assert.deepEqual(config.visionDelegate, {
      enabled: true,
      providerID: "file-provider",
      modelID: "env-model",
      prompt: "Env prompt",
      timeoutMs: 7000,
      deleteAfter: false,
    })
  })

  it("supports an explicit home-relative config path", () => {
    assert.equal(
      defaultConfigPath({ OPENCODE_SEE_CONFIG: "~/see.json" }, "/home/test", "linux"),
      "/home/test/see.json",
    )
  })

  it("reports invalid JSON with the config path", async () => {
    const root = await mkdtemp(join(tmpdir(), "opencode-see-invalid-"))
    roots.push(root)
    const path = join(root, "bad.json")
    await writeFile(path, "{")
    await assert.rejects(
      loadConfig("/work", { OPENCODE_SEE_CONFIG: path }, "/home/test", "linux"),
      new RegExp(`Invalid JSON.*${path.replaceAll("/", "\\/")}`),
    )
  })

  it("rejects invalid numeric values", async () => {
    await assert.rejects(
      loadConfig("/work", { OPENCODE_SEE_VIEWPORT_WIDTH: "0" }, "/home/test", "linux"),
      /viewport width must be a positive integer/,
    )
  })

  it("rejects invalid delegate booleans", async () => {
    await assert.rejects(
      loadConfig("/work", { OPENCODE_SEE_DELEGATE_ENABLED: "maybe" }, "/home/test", "linux"),
      /visionDelegate.enabled must be a boolean/,
    )
  })
})
