import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { MAX_IMAGES } from "./constants.js"

const HISTORY_LIMIT = 32
const REPLAY_TEXT =
  "These image attachments were restored after context compaction. Inspect them and continue the original task; do not treat this as a new request."
const IMAGE_TOOLS = new Set(["image_view", "screenshot"])

type Transform = NonNullable<Hooks["experimental.chat.messages.transform"]>
type MessageWithParts = Parameters<Transform>[1]["messages"][number]
type Part = MessageWithParts["parts"][number]
type FilePart = Extract<Part, { type: "file" }>

type Boundary = {
  marker: MessageWithParts
  summary: MessageWithParts & { info: Extract<MessageWithParts["info"], { role: "assistant" }> }
  sessionID: string
  turnID: string
}

export function createCompactionReplay(client: PluginInput["client"]): Transform {
  return async (_input, output) => {
    const boundary = findBoundary(output.messages)
    if (!boundary) return

    try {
      const response = await client.session.messages({
        path: { id: boundary.sessionID },
        query: { limit: HISTORY_LIMIT },
      })
      if (!response.data) return

      const attachments = findAttachments(response.data, boundary)
      if (attachments.length === 0) return
      output.messages.push(replayMessage(boundary, attachments))
    } catch (error) {
      console.warn(
        `[opencode-see] Could not restore image attachments after context compaction: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
}

function findBoundary(messages: MessageWithParts[]): Boundary | undefined {
  const marker = messages.at(-2)
  const summary = messages.at(-1)
  if (!marker || marker.info.role !== "user" || !summary || summary.info.role !== "assistant") return
  if (summary.info.summary !== true || !summary.info.finish || summary.info.error) return
  if (summary.info.parentID !== marker.info.id) return

  let turnID: string | undefined
  for (const part of marker.parts) {
    turnID = remoteMidTurnID(part)
    if (turnID) break
  }
  if (!turnID) return
  return {
    marker,
    summary: summary as Boundary["summary"],
    sessionID: marker.info.sessionID,
    turnID,
  }
}

function remoteMidTurnID(part: Part): string | undefined {
  if (part.type !== "compaction" || part.auto !== true) return
  const value = part as typeof part & { phase?: unknown; turn_id?: unknown; remote?: unknown }
  if (value.phase !== "mid-turn" || typeof value.turn_id !== "string" || !isRecord(value.remote)) return
  return value.remote.providerID === "openai" ? value.turn_id : undefined
}

function findAttachments(history: MessageWithParts[], boundary: Boundary): FilePart[] {
  const markerIndex = history.findIndex((message) => message.info.id === boundary.marker.info.id)
  if (markerIndex < 0) return []
  const source = latestAssistant(history, markerIndex, boundary.turnID)
  if (!source) return []

  const seen = new Set<string>()
  return source.parts
    .flatMap((part) => {
      if (part.type !== "tool" || !IMAGE_TOOLS.has(part.tool) || part.state.status !== "completed") return []
      return part.state.attachments ?? []
    })
    .filter((attachment) => {
      if (!attachment.mime.startsWith("image/") || !attachment.url.startsWith("data:image/")) return false
      if (seen.has(attachment.url)) return false
      seen.add(attachment.url)
      return true
    })
    .slice(0, MAX_IMAGES)
}

function latestAssistant(history: MessageWithParts[], markerIndex: number, turnID: string) {
  for (let index = markerIndex - 1; index >= 0; index--) {
    const message = history[index]
    if (
      message?.info.role === "assistant" &&
      message.info.parentID === turnID &&
      message.info.summary !== true
    )
      return message
  }
}

function replayMessage(boundary: Boundary, attachments: ReturnType<typeof findAttachments>): MessageWithParts {
  const messageID = `${boundary.marker.info.id}-opencode-see-replay`
  return {
    info: {
      ...boundary.marker.info,
      id: messageID,
      time: {
        created: boundary.summary.info.time.completed ?? boundary.summary.info.time.created,
      },
    },
    parts: [
      {
        id: `${messageID}-text`,
        messageID,
        sessionID: boundary.sessionID,
        type: "text",
        text: REPLAY_TEXT,
        synthetic: true,
      },
      ...attachments.map((attachment, index) => ({
        ...attachment,
        id: `${messageID}-image-${index}`,
        messageID,
        sessionID: boundary.sessionID,
      })),
    ],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
