import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { CaptureUnavailableError, captureScreenshot } from "./capture.js"
import { rememberModelCapability, type ModelCapabilityCache } from "./capability.js"
import { createCompactionReplay } from "./compaction-replay.js"
import { loadConfig } from "./config.js"
import { MAX_IMAGES } from "./constants.js"
import { formatSessionImageMetadata, viewSessionImages } from "./session-images.js"
import { authorizeImagePaths, formatImageMetadata, viewImages, type PreparedImage } from "./view.js"
import { createVisualResult } from "./vision.js"

const TEXT_ONLY_IMAGE_GUIDANCE =
  'This model cannot inspect image bytes. For any image attachment, path, reference, or unsupported-image error, use exactly one image_view call as the first and only visual action. An attachment filename is not a path: use source="latest"; use paths only for an explicit real path. Pass the user\'s exact visual question as question, then rely on the "Vision via" result even if incomplete. Never inspect the image with read, glob, bash, ffmpeg, Python, screenshot, or file search, and never reopen it.'

export const OpenCodeSeePlugin: Plugin = async ({ client }) => {
  const capabilities: ModelCapabilityCache = new Map()
  return {
    tool: {
      image_view: tool({
        description:
          'Show one to five PNG, JPEG, WebP, or GIF images to the active model. Pass paths for local files, source="latest" for the latest current-session image batch, or source="session" for up to five recent current-session images. With neither paths nor source, the latest session batch is used. Vision-capable models receive standard attachments; text-only models can receive a delegated text description focused by question.',
        args: {
          paths: tool.schema
            .array(tool.schema.string().min(1))
            .min(1)
            .max(MAX_IMAGES)
            .optional()
            .describe("One to five project-relative, absolute, or home-relative image paths"),
          source: tool.schema
            .enum(["latest", "session"])
            .optional()
            .describe('Use "latest" for the newest image batch or "session" for up to five newest unique images in the current session'),
          question: tool.schema
            .string()
            .min(1)
            .max(4_000)
            .optional()
            .describe("A specific visual question for the vision delegate"),
        },
        async execute(args, context) {
          const config = await loadConfig(context.directory)
          if (args.paths && args.source) throw new Error("image_view accepts paths or source, not both")
          let images: PreparedImage[]
          let metadata: string
          if (args.paths) {
            const localImages = await viewImages({
              paths: args.paths,
              directory: context.directory,
              authorize: (paths) => authorizeImagePaths(context, paths),
            })
            images = localImages
            metadata = formatImageMetadata(localImages)
          } else {
            const sessionImages = await viewSessionImages({
              client,
              sessionID: context.sessionID,
              source: args.source ?? "latest",
            })
            images = sessionImages
            metadata = formatSessionImageMetadata(sessionImages)
          }
          const result = await createVisualResult({
            client,
            capabilities,
            context,
            images,
            metadata,
            config,
            question: args.question,
          })
          return {
            title: images.length === 1 ? "Viewed image" : `Viewed ${images.length} images`,
            ...result,
          }
        },
      }),
      screenshot: tool({
        description:
          "Capture an HTTP or HTTPS page with Chromium and show it to the active model. Vision-capable models receive the PNG attachment; text-only models can receive a delegated description.",
        args: {
          url: tool.schema.string().url().describe("The http:// or https:// page to capture"),
          output_path: tool.schema
            .string()
            .min(1)
            .optional()
            .describe("Optional relative PNG path inside the configured screenshot directory"),
          width: tool.schema.number().int().positive().optional().describe("Viewport width in CSS pixels"),
          height: tool.schema.number().int().positive().optional().describe("Viewport height in CSS pixels"),
          question: tool.schema
            .string()
            .min(1)
            .max(4_000)
            .optional()
            .describe("A specific visual question for the vision delegate"),
        },
        async execute(args, context) {
          const config = await loadConfig(context.directory)
          try {
            const screenshot = await captureScreenshot({
              url: args.url,
              outputPath: args.output_path,
              width: args.width,
              height: args.height,
              config,
              signal: context.abort,
            })
            const result = await createVisualResult({
              client,
              capabilities,
              context,
              images: [{
                mime: "image/png",
                dataUrl: `data:image/png;base64,${screenshot.bytes.toString("base64")}`,
                filename: screenshot.filename,
              }],
              metadata: `Screenshot saved to ${screenshot.absolutePath}\nCapture backend: ${screenshot.backend}\nViewport: ${screenshot.width}×${screenshot.height}\nBytes: ${screenshot.bytes.length}`,
              config,
              question: args.question,
            })
            return {
              title: "Captured screenshot",
              ...result,
            }
          } catch (error) {
            if (error instanceof CaptureUnavailableError) {
              return { title: "Screenshot unavailable", output: error.message, attachments: [] }
            }
            throw error
          }
        },
      }),
    },
    "experimental.chat.system.transform": async (input, output) => {
      if (input.model.capabilities?.input?.image === false) output.system.push(TEXT_ONLY_IMAGE_GUIDANCE)
    },
    "chat.params": async (input) => {
      rememberModelCapability(capabilities, input.sessionID, input.model)
    },
    event: async ({ event }) => {
      if (event.type === "session.deleted") capabilities.delete(event.properties.info.id)
    },
    "experimental.chat.messages.transform": createCompactionReplay(client),
  }
}

export default OpenCodeSeePlugin
