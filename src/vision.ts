import type { PluginInput, ToolContext } from "@opencode-ai/plugin"
import { resolveModelCapability, type ModelCapabilityCache } from "./capability.js"
import type { SeeConfig } from "./config.js"
import { describeImages, type DelegateImage } from "./delegate.js"

export type VisualResult = {
  output: string
  attachments: Array<{ type: "file"; mime: string; url: string; filename: string }>
}

export async function createVisualResult(input: {
  client: PluginInput["client"]
  capabilities: ModelCapabilityCache
  context: Pick<ToolContext, "sessionID" | "abort">
  images: DelegateImage[]
  metadata: string
  config: SeeConfig
  question?: string
}): Promise<VisualResult> {
  const capability = await resolveModelCapability(
    input.client,
    input.capabilities,
    input.context.sessionID,
    input.config.visionDelegate,
  )
  const activeModel = `${capability.providerID}/${capability.modelID}`
  const forced = input.config.visionDelegate.forceFor?.includes(activeModel) === true
  if (capability.image && !forced) {
    return {
      output: input.metadata,
      attachments: input.images.map((image) => ({
        type: "file",
        mime: image.mime,
        url: image.dataUrl,
        filename: image.filename,
      })),
    }
  }

  if (!input.config.visionDelegate.enabled) {
    return {
      output: forced
        ? `${input.metadata}\n\nVision delegation is required because ${activeModel} is listed in visionDelegate.forceFor, but visionDelegate.enabled is false.`
        : `${input.metadata}\n\nVision unavailable: the active model does not support image input. Enable visionDelegate in opencode-see.json.`,
      attachments: [],
    }
  }

  try {
    const description = await describeImages(
      input.client,
      input.images,
      input.config.visionDelegate,
      input.context.abort,
      input.question,
    )
    return {
      output: `${input.metadata}\n\nVision via ${input.config.visionDelegate.modelID}:\n${description}`,
      attachments: [],
    }
  } catch (error) {
    return {
      output: `${input.metadata}\n\nVision delegation failed via ${input.config.visionDelegate.modelID}: ${error instanceof Error ? error.message : String(error)}. No visual description was produced.`,
      attachments: [],
    }
  }
}
