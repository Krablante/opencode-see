import type { PluginInput } from "@opencode-ai/plugin"
import type { VisionDelegateConfig } from "./config.js"

export type DelegateImage = {
  mime: string
  filename: string
  dataUrl: string
}

export async function describeImages(
  client: PluginInput["client"],
  images: DelegateImage[],
  config: VisionDelegateConfig,
  signal: AbortSignal,
): Promise<string> {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs)])
  const created = await client.session.create({
    body: { title: "opencode-see delegate" },
    signal: requestSignal,
    throwOnError: true,
  })
  const sessionID = created.data.id

  try {
    const response = await client.session.prompt({
      path: { id: sessionID },
      body: {
        model: { providerID: config.providerID, modelID: config.modelID },
        parts: [
          { type: "text", text: config.prompt },
          ...images.map((image) => ({
            type: "file" as const,
            mime: image.mime,
            filename: image.filename,
            url: image.dataUrl,
          })),
        ],
      },
      signal: requestSignal,
      throwOnError: true,
    })
    const text = response.data.parts
      .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n")
    if (!text) throw new Error("Vision delegate returned no assistant text")
    return text
  } finally {
    if (config.deleteAfter) {
      try {
        await client.session.delete({
          path: { id: sessionID },
          signal: AbortSignal.timeout(Math.min(config.timeoutMs, 10_000)),
          throwOnError: true,
        })
      } catch (error) {
        console.warn(
          `[opencode-see] Could not delete vision delegate session ${sessionID}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }
}
