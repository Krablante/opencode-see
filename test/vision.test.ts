import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ModelCapabilityCache } from "../src/capability.js"
import type { SeeConfig } from "../src/config.js"
import { createVisualResult } from "../src/vision.js"
import { describeImages } from "../src/delegate.js"
import { createCompactionReplay } from "../src/compaction-replay.js"
import * as pluginModule from "../src/index.js"

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

describe("plugin contract", () => {
  it("exports only one initializer and gives visual tool guidance only to text-only models", async () => {
    assert.equal(new Set(Object.values(pluginModule)).size, 1)
    const hooks = await pluginModule.OpenCodeSeePlugin({ client: {} } as PluginInput)
    for (const imageCapability of [true, false]) {
      const output = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]!({ model: { capabilities: { input: { image: imageCapability } } } } as never, output)
      assert.equal(output.system.length, imageCapability ? 0 : 1)
      if (!imageCapability) {
        assert.match(output.system[0], /use screenshot with its URL/)
        assert.match(output.system[0], /source="latest"/)
      }
    }
  })
})

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
      body: { model: unknown; tools: unknown; parts: Array<Record<string, unknown>> }
    }
    assert.deepEqual(prompt.body.model, { providerID: "opencode-go", modelID: "gpt-5.6-luna" })
    assert.deepEqual(prompt.body.tools, { "*": false })
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

  it("delegates only the exact forced native model and preserves the question", async () => {
    let promptText = ""
    const client = { session: {
      create: async () => ({ data: { id: "d" } }),
      prompt: async (input: { body: { parts: Array<{ text?: string }> } }) => {
        promptText = input.body.parts[0].text ?? ""
        return { data: { parts: [{ type: "text", text: "visible error" }] } }
      },
      delete: async () => ({ data: true }),
    } } as unknown as PluginInput["client"]
    const input = { client, capabilities: new Map([["s", { providerID: "custom", modelID: "native", image: true }]]), context: context("s"), images: [image], metadata: "meta", question: "Read the error", config: { ...config, visionDelegate: { ...config.visionDelegate, forceFor: ["custom/native"] } } }
    assert.deepEqual((await createVisualResult(input)).attachments, [])
    assert.match(promptText, /Describe every image\.[\s\S]*Read the error/)
    assert.equal((await createVisualResult({ ...input, config })).attachments.length, 1)
  })

  it("stops a timed-out server session even when it is retained", async () => {
    const calls: string[] = []
    const client = { session: {
      create: async () => ({ data: { id: "d" } }),
      prompt: async (input: { signal: AbortSignal }) => {
        calls.push("prompt")
        await new Promise<void>((_resolve, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason), { once: true })
          // Keep the process alive while AbortSignal.timeout's unref'd timer fires.
          const timer = setTimeout(() => reject(new Error("test stalled")), 1000)
          input.signal.addEventListener("abort", () => clearTimeout(timer), { once: true })
        })
        throw new Error("unreachable")
      },
      abort: async () => { calls.push("abort"); return { data: true } },
      delete: async () => { calls.push("delete"); return { data: true } },
    } } as unknown as PluginInput["client"]
    await assert.rejects(describeImages(client, [image], { ...config.visionDelegate, timeoutMs: 10, deleteAfter: false }, context("s").abort), /timeout/i)
    assert.deepEqual(calls, ["prompt", "abort"])
  })

  it("propagates caller cancellation before creating a delegate", async () => {
    const abort = AbortSignal.abort(new Error("cancelled"))
    await assert.rejects(createVisualResult({ client: {} as PluginInput["client"], capabilities: new Map(), context: { sessionID: "s", abort }, images: [image], metadata: "meta", config }), /cancelled/)
  })

  it("does not return partial assistant text when the server reports an error", async () => {
    const client = { session: {
      create: async () => ({ data: { id: "d" } }),
      prompt: async () => ({ data: { info: { error: { name: "APIError", data: { message: "provider failed", responseBody: "private response body" } } }, parts: [{ type: "text", text: "partial answer" }] } }),
      delete: async () => ({ data: true }),
    } } as unknown as PluginInput["client"]
    await assert.rejects(describeImages(client, [image], config.visionDelegate, context("s").abort), (error: unknown) => {
      assert.match(String(error), /provider failed/)
      assert.doesNotMatch(String(error), /private response body|partial answer/)
      return true
    })
  })
})

describe("compaction replay", () => {
  function projection(remote = true) {
    return { messages: [
      { info: { role: "user", id: "marker", sessionID: "s", time: { created: 1 } }, parts: [{ type: "compaction", auto: true, phase: "mid-turn", turn_id: "turn", remote: { providerID: remote ? "openai" : "other" } }] },
      { info: { role: "assistant", id: "summary", sessionID: "s", parentID: "marker", summary: true, finish: "stop", time: { created: 2, completed: 3 } }, parts: [] },
    ] } as unknown as Parameters<ReturnType<typeof createCompactionReplay>>[1]
  }

  it("restores only completed visual attachments at the exact remote boundary", async () => {
    const output = projection()
    const attachment = { type: "file", mime: image.mime, url: image.dataUrl, filename: image.filename }
    const client = { session: { messages: async () => ({ data: [
      { info: { role: "assistant", parentID: "turn" }, parts: [
        { type: "tool", tool: "image_view", state: { status: "completed", attachments: [attachment, attachment] } },
        { type: "tool", tool: "read", state: { status: "completed", attachments: [{ ...attachment, url: "data:image/png;base64,other" }] } },
      ] },
      ...output.messages,
    ] }) } } as unknown as PluginInput["client"]
    await createCompactionReplay(client)({}, output)
    assert.equal(output.messages.length, 3)
    assert.equal(output.messages[2].parts.filter((part) => part.type === "file").length, 1)
    assert.equal(output.messages[2].info.sessionID, "s")
  })

  it("does no history I/O for ordinary turns or other remote providers", async () => {
    let calls = 0
    const client = { session: { messages: async () => { calls++; return { data: [] } } } } as unknown as PluginInput["client"]
    const replay = createCompactionReplay(client)
    const other = projection(false)
    await replay({}, other)
    assert.equal(other.messages.length, 2)
    const ordinary = projection()
    ordinary.messages.pop()
    await replay({}, ordinary)
    assert.equal(ordinary.messages.length, 1)
    assert.equal(calls, 0)
  })
})
