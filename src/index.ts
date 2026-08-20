import type { Plugin, ToolContext } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import { CaptureUnavailableError, captureScreenshot } from "./capture.js"
import { loadConfig } from "./config.js"
import { MAX_IMAGES } from "./constants.js"
import { formatImageMetadata, viewImages } from "./view.js"

function containsPath(root: string, target: string): boolean {
  const distance = relative(resolve(root), resolve(target))
  return distance === "" || (!distance.startsWith("..") && !isAbsolute(distance))
}

export async function authorizeImagePaths(context: ToolContext, paths: string[]): Promise<void> {
  const externalPatterns = [
    ...new Set(
      paths
        .filter((path) => !containsPath(context.worktree, path))
        .map((path) => join(dirname(path), "*").replaceAll("\\", "/")),
    ),
  ]
  if (externalPatterns.length > 0) {
    await context.ask({
      permission: "external_directory",
      patterns: externalPatterns,
      always: externalPatterns,
      metadata: { paths },
    })
  }
  const readPatterns = paths.map((path) => relative(context.worktree, path).replaceAll("\\", "/"))
  await context.ask({ permission: "read", patterns: readPatterns, always: readPatterns, metadata: { paths } })
}

export const OpenCodeSeePlugin: Plugin = async () => ({
  tool: {
    image_view: tool({
      description:
        "Show one to five local PNG, JPEG, WebP, or GIF images to the active vision-capable model. Accepts project-relative, absolute, and home-relative paths and returns standard OpenCode file attachments plus image metadata.",
      args: {
        paths: tool.schema
          .array(tool.schema.string().min(1))
          .min(1)
          .max(MAX_IMAGES)
          .describe("One to five project-relative, absolute, or home-relative image paths"),
      },
      async execute(args, context) {
        const images = await viewImages({
          paths: args.paths,
          directory: context.directory,
          authorize: (paths) => authorizeImagePaths(context, paths),
        })
        return {
          title: images.length === 1 ? "Viewed image" : `Viewed ${images.length} images`,
          output: formatImageMetadata(images),
          attachments: images.map((image) => ({
            type: "file" as const,
            mime: image.mime,
            url: image.dataUrl,
            filename: image.filename,
          })),
        }
      },
    }),
    screenshot: tool({
      description:
        "Capture an HTTP or HTTPS page with Chromium, save it as PNG in the configured screenshot directory, and show it to the active vision-capable model. Uses CDP first and a lightweight Chromium CLI fallback.",
      args: {
        url: tool.schema.string().url().describe("The http:// or https:// page to capture"),
        output_path: tool.schema
          .string()
          .min(1)
          .optional()
          .describe("Optional relative PNG path inside the configured screenshot directory"),
        width: tool.schema.number().int().positive().optional().describe("Viewport width in CSS pixels"),
        height: tool.schema.number().int().positive().optional().describe("Viewport height in CSS pixels"),
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
          return {
            title: "Captured screenshot",
            output: `Screenshot saved to ${screenshot.absolutePath}\nCapture backend: ${screenshot.backend}\nViewport: ${screenshot.width}×${screenshot.height}\nBytes: ${screenshot.bytes.length}`,
            attachments: [{
              type: "file" as const,
              mime: "image/png",
              url: `data:image/png;base64,${screenshot.bytes.toString("base64")}`,
              filename: screenshot.filename,
            }],
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
})

export default OpenCodeSeePlugin
