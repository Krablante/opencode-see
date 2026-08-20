import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ModelCapabilityCache } from "../src/capability.js"
import type { SeeConfig } from "../src/config.js"
import { createVisualResult } from "../src/vision.js"

const config: SeeConfig = {
  screenshotDirectory: ".opencode/screenshots",
  screenshotRoot: "/tmp/screenshots",
  viewport: { width: 1440, height: 900 },
  virtualTimeBudgetMs: 2000,
  screenshotTimeoutMs: 30000,
  visionDelegate: {
    enabled: true,
    model: "opencode-go/gpt-5.6-luna",
    providerID: "opencode-go",
    modelID: "gpt-5.6-luna",
    prompt: "Describe every image.",
    timeoutMs: 90000,
    deleteAfter: true,
  },
  configPath: "/tmp/opencode-see.json",
}

const image = {
  mime: "image/png",
  filename: "test.png",
  dataUrl: "data:image/png;base64,aGVsbG8=",
}

function context(sessionID: string) {
  return { sessionID, abort: new AbortController().signal }
}

describe("vision routing", () => {
  it("delegates text-only sessions and returns the vision text", async () => {
    const calls: Array<{ method: string; input: unknown }> = []
    const client = {
      session: {
        create: async (input: unknown) => {
          calls.push({ method: "create", input })
          return { data: { id: "delegate-session" } }
        },
        prompt: async (input: unknown) => {
          calls.push({ method: "prompt", input })
          return { data: { parts: [{ type: "text", text: "A blue square." }] } }
        },
        delete: async (input: unknown) => {
          calls.push({ method: "delete", input })
          return { data: true }
        },
      },
    } as unknown as PluginInput["client"]
    const capabilities: ModelCapabilityCache = new Map([
      ["text-session", { providerID: "opencode-go", modelID: "deepseek-v4-flash", image: false }],
    ])

    const result = await createVisualResult({
      client,
      capabilities,
      context: context("text-session"),
      images: [image],
      metadata: "Image metadata:",
      config,
    })

    assert.match(result.output, /Vision via gpt-5\.6-luna:\nA blue square\./)
    assert.deepEqual(result.attachments, [])
    assert.deepEqual(calls.map((call) => call.method), ["create", "prompt", "delete"])
    const prompt = calls[1].input as {
      body: { model: unknown; parts: Array<Record<string, unknown>> }
    }
    assert.deepEqual(prompt.body.model, { providerID: "opencode-go", modelID: "gpt-5.6-luna" })
    assert.deepEqual(prompt.body.parts[1], {
      type: "file",
      mime: "image/png",
      filename: "test.png",
      url: image.dataUrl,
    })
  })

  it("returns attachments to vision sessions without invoking the delegate", async () => {
    const client = {
      session: {
        create: async () => { throw new Error("delegate must not run") },
      },
    } as unknown as PluginInput["client"]
    const capabilities: ModelCapabilityCache = new Map([
      ["vision-session", { providerID: "opencode-go", modelID: "gpt-5.6-luna", image: true }],
    ])

    const result = await createVisualResult({
      client,
      capabilities,
      context: context("vision-session"),
      images: [image],
      metadata: "Image metadata:",
      config,
    })

    assert.equal(result.output, "Image metadata:")
    assert.equal(result.attachments.length, 1)
    assert.equal(result.attachments[0].url, image.dataUrl)
  })

  it("reports delegate failures without inventing an image description", async () => {
    let deleted = false
    const client = {
      session: {
        create: async () => ({ data: { id: "delegate-session" } }),
        prompt: async () => { throw new Error("provider unavailable") },
        delete: async () => {
          deleted = true
          return { data: true }
        },
      },
    } as unknown as PluginInput["client"]
    const capabilities: ModelCapabilityCache = new Map([
      ["text-session", { providerID: "opencode-go", modelID: "deepseek-v4-flash", image: false }],
    ])

    const result = await createVisualResult({
      client,
      capabilities,
      context: context("text-session"),
      images: [image],
      metadata: "Image metadata:",
      config,
    })

    assert.match(result.output, /Vision delegation failed via gpt-5\.6-luna: provider unavailable/)
    assert.match(result.output, /No visual description was produced/)
    assert.doesNotMatch(result.output, /blue square/)
    assert.equal(deleted, true)
  })

  it("returns an actionable message when delegation is disabled", async () => {
    const client = {} as PluginInput["client"]
    const capabilities: ModelCapabilityCache = new Map([
      ["text-session", { providerID: "opencode-go", modelID: "deepseek-v4-flash", image: false }],
    ])
    const result = await createVisualResult({
      client,
      capabilities,
      context: context("text-session"),
      images: [image],
      metadata: "Image metadata:",
      config: { ...config, visionDelegate: { ...config.visionDelegate, enabled: false } },
    })
    assert.match(result.output, /active model does not support image input/)
    assert.deepEqual(result.attachments, [])
  })
})
