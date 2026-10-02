import type { PluginInput } from "@opencode-ai/plugin"

export type ModelCapability = {
  providerID: string
  modelID: string
  image: boolean
}

export type ModelCapabilityCache = Map<string, ModelCapability>

export function rememberModelCapability(
  cache: ModelCapabilityCache,
  sessionID: string,
  model: {
    id: string
    providerID: string
    capabilities?: { input?: { image?: boolean } }
  },
): void {
  cache.set(sessionID, {
    providerID: model.providerID,
    modelID: model.id,
    image: model.capabilities?.input?.image ?? false,
  })
}

export async function resolveModelCapability(
  client: PluginInput["client"],
  cache: ModelCapabilityCache,
  sessionID: string,
  signal?: AbortSignal,
): Promise<ModelCapability> {
  signal?.throwIfAborted()
  const cached = cache.get(sessionID)
  if (cached) return cached

  try {
    const response = await client.session.get({ path: { id: sessionID }, signal, throwOnError: true })
    const model = sessionModel(response.data)
    if (!model) return { providerID: "unknown", modelID: "unknown", image: false }
    const embedded = embeddedImageCapability(model.raw)
    if (embedded !== undefined) {
      return cacheCapability(cache, sessionID, {
        providerID: model.providerID,
        modelID: model.modelID,
        image: embedded,
      })
    }

    try {
      const providers = await client.config.providers({ signal, throwOnError: true })
      const catalogModel = providers.data.providers
        .find((provider) => provider.id === model.providerID)
        ?.models[model.modelID]
      if (catalogModel) {
        return cacheCapability(cache, sessionID, {
          providerID: model.providerID,
          modelID: model.modelID,
          image: catalogModel.capabilities?.input?.image ?? false,
        })
      }
    } catch {
      signal?.throwIfAborted()
      // A configured model name alone does not prove image support.
    }

    return cacheCapability(cache, sessionID, {
      providerID: model.providerID,
      modelID: model.modelID,
      image: false,
    })
  } catch {
    signal?.throwIfAborted()
    return { providerID: "unknown", modelID: "unknown", image: false }
  }
}

function sessionModel(value: unknown): { providerID: string; modelID: string; raw: unknown } | undefined {
  if (!isRecord(value) || !isRecord(value.model) || typeof value.model.providerID !== "string") return
  const modelID = typeof value.model.modelID === "string"
    ? value.model.modelID
    : typeof value.model.id === "string"
      ? value.model.id
      : undefined
  if (!modelID) return
  return { providerID: value.model.providerID, modelID, raw: value.model }
}

function embeddedImageCapability(value: unknown): boolean | undefined {
  if (!isRecord(value) || !isRecord(value.capabilities) || !isRecord(value.capabilities.input)) return
  return typeof value.capabilities.input.image === "boolean" ? value.capabilities.input.image : undefined
}

function cacheCapability(
  cache: ModelCapabilityCache,
  sessionID: string,
  capability: ModelCapability,
): ModelCapability {
  cache.set(sessionID, capability)
  return capability
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
