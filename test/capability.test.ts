import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { resolveModelCapability, type ModelCapabilityCache } from "../src/capability.js"

describe("model capability fallback", () => {
  it("resolves the current session model against the provider catalog when chat.params was not cached", async () => {
    const client = {
      session: {
        get: async () => ({
          data: { model: { providerID: "opencode-go", id: "gpt-5.6-luna" } },
        }),
      },
      config: {
        providers: async () => ({
          data: {
            providers: [{
              id: "opencode-go",
              models: {
                "gpt-5.6-luna": { capabilities: { input: { image: true } } },
              },
            }],
          },
        }),
      },
    } as unknown as PluginInput["client"]
    const cache: ModelCapabilityCache = new Map()

    const capability = await resolveModelCapability(client, cache, "session")

    assert.deepEqual(capability, {
      providerID: "opencode-go",
      modelID: "gpt-5.6-luna",
      image: true,
    })
    assert.deepEqual(cache.get("session"), capability)
  })

  it("does not assume image capability when the catalog is unavailable", async () => {
    const client = {
      session: { get: async () => ({ data: { model: { providerID: "custom", modelID: "text-only" } } }) },
      config: { providers: async () => { throw new Error("unavailable") } },
    } as unknown as PluginInput["client"]
    assert.deepEqual(await resolveModelCapability(client, new Map(), "s"), { providerID: "custom", modelID: "text-only", image: false })
  })
})
