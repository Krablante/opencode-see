#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createServer } from "node:http"
import { existsSync, readFileSync } from "node:fs"
import { copyFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { captureScreenshot } from "../src/capture.ts"
import { formatImageMetadata, viewImages } from "../src/view.ts"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const assetsDir = path.join(repositoryRoot, "assets")
const packageVersion = JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version
const WIDTH = 1000
const HEIGHT = 620
const FPS = 10
const DURATION = 18

const translations = {
  en: {
    title: "the model sees the local file",
    note: "real image reader + real Chromium CDP capture",
    viewCommand: "image_view --paths scene.png photo.jpg card.webp motion.gif",
    captureCommand: "screenshot --url http://127.0.0.1:<port>",
    attachment: "4 standard image attachments returned",
    captured: "screenshot attachment returned",
  },
  ru: {
    title: "модель видит локальный файл",
    note: "настоящее чтение файлов + настоящий Chromium CDP",
    viewCommand: "image_view --paths scene.png photo.jpg card.webp motion.gif",
    captureCommand: "screenshot --url http://127.0.0.1:<port>",
    attachment: "возвращены 4 стандартных image attachments",
    captured: "возвращён attachment скриншота",
  },
}

function fail(message) { throw new Error(message) }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: repositoryRoot, encoding: "utf8", ...options })
  if (result.error) fail(`${command} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    fail([`${command} ${args.join(" ")} failed`, result.stdout?.trimEnd(), result.stderr?.trimEnd()].filter(Boolean).join("\n"))
  }
  return result.stdout.trimEnd()
}

function resolveFontsDir() {
  const candidates = [
    process.env.OPENCODE_SEE_DEMO_FONTS_DIR,
    "/usr/share/fonts/truetype/dejavu",
    "/usr/local/share/fonts/dejavu",
  ].filter(Boolean)
  const found = candidates.find((candidate) =>
    existsSync(path.join(candidate, "DejaVuSans.ttf")) && existsSync(path.join(candidate, "DejaVuSansMono.ttf")),
  )
  if (!found) fail("DejaVu Sans fonts were not found; set OPENCODE_SEE_DEMO_FONTS_DIR")
  return found
}

function generateImages(workDir) {
  const specs = [
    ["color=c=0xe85d75:s=640x360", "scene.png"],
    ["testsrc2=s=640x360", "photo.jpg"],
    ["smptebars=s=640x360", "card.webp"],
  ]
  for (const [source, name] of specs) {
    run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", source, "-frames:v", "1", path.join(workDir, name)])
  }
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=320x180:r=5:d=1", path.join(workDir, "motion.gif")])
}

function normalize(text, workDir) {
  return String(text).replaceAll(workDir, "<demo>").replaceAll(/127\.0\.0\.1:\d+/g, "127.0.0.1:<port>")
}

async function captureRealFlow(workDir) {
  generateImages(workDir)
  const paths = ["scene.png", "photo.jpg", "card.webp", "motion.gif"]
  const images = await viewImages({ paths, directory: workDir, authorize: async () => {} })
  const metadata = normalize(formatImageMetadata(images), workDir)
  const html = Buffer.from(`<!doctype html><meta charset="utf-8"><style>body{margin:0;min-height:1100px;background:#0d1117;color:#f5eee6;font:32px system-ui;padding:80px}h1{font-size:90px;max-width:800px;color:#e85d75}</style><h1>opencode-see</h1><p>Real localhost capture through CDP.</p>`)
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
    response.end(html)
  })
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  if (!address || typeof address === "string") fail("demo server did not expose a TCP port")
  let screenshot
  try {
    screenshot = await captureScreenshot({
      url: `http://127.0.0.1:${address.port}`,
      outputPath: "demo-page.png",
      config: {
        screenshotDirectory: workDir,
        screenshotRoot: workDir,
        viewport: { width: 1000, height: 620 },
        virtualTimeBudgetMs: 100,
        screenshotTimeoutMs: 30_000,
        configPath: "/dev/null",
      },
    })
  } finally {
    server.close()
  }
  return {
    metadata,
    screenshot: normalize([
      `Screenshot saved to ${screenshot.absolutePath}`,
      `Capture backend: ${screenshot.backend}`,
      `Viewport: ${screenshot.width}×${screenshot.height}`,
      `Bytes: ${screenshot.bytes.length}`,
    ].join("\n"), workDir),
  }
}

function assTime(seconds) {
  const centiseconds = Math.round(seconds * 100)
  const hours = Math.floor(centiseconds / 360000)
  const minutes = Math.floor((centiseconds % 360000) / 6000)
  const secs = Math.floor((centiseconds % 6000) / 100)
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`
}

function escapeAss(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("{", "\\{").replaceAll("}", "\\}")
}

function body(text) {
  return text.split("\n").map((line) => {
    if (line.startsWith("$ ")) return `{\\c&H00755DE8&}$ {\\c&H00F6EEF5&}${escapeAss(line.slice(2))}`
    if (line.startsWith("Image metadata:")) return `{\\c&H00755DE8&}${escapeAss(line)}`
    if (line.startsWith("✓")) return `{\\c&H0071C982&}${escapeAss(line)}`
    return escapeAss(line)
  }).join("\\N")
}

function assDocument(language, flow) {
  const copy = translations[language]
  const end = assTime(DURATION)
  const frames = [
    { start: 0, end: 8.5, text: `$ ${copy.viewCommand}\n${flow.metadata}\n✓ ${copy.attachment}` },
    { start: 8.5, end: DURATION, text: `$ ${copy.captureCommand}\n${flow.screenshot}\n✓ ${copy.captured}` },
  ]
  const events = [
    `Dialogue: 0,0:00:00.00,${end},Header,,0,0,0,,{\\c&H00755DE8&\\b1}opencode-see{\\c&H009E948B&\\b0}  —  ${escapeAss(copy.title)}`,
    `Dialogue: 0,0:00:00.00,${end},Chrome,,0,0,0,,{\\c&H004355F8&}■  {\\c&H0039A7FE&}■  {\\c&H0046C85A&}■`,
    `Dialogue: 0,0:00:00.00,${end},Note,,0,0,0,,${escapeAss(copy.note)} · v${escapeAss(packageVersion)}`,
    ...frames.map((frame) => `Dialogue: 0,${assTime(frame.start)},${assTime(frame.end)},Body,,0,0,0,,${body(frame.text)}`),
  ]
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${WIDTH}\nPlayResY: ${HEIGHT}\nWrapStyle: 2\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Header,DejaVu Sans,19,&H009E948B,&H009E948B,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,8,30,30,16,1\nStyle: Chrome,DejaVu Sans,13,&H009E948B,&H009E948B,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,7,19,30,20,1\nStyle: Body,DejaVu Sans Mono,17,&H00D9D1C9,&H00D9D1C9,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,7,38,30,78,1\nStyle: Note,DejaVu Sans,15,&H009E948B,&H009E948B,&H000D1117,&H000D1117,0,0,0,0,100,100,0,0,1,0,0,3,30,30,18,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events.join("\n")}\n`
}

async function render(language, flow, workDir) {
  const assPath = path.join(workDir, `demo-${language}.ass`)
  const palettePath = path.join(workDir, `demo-${language}-palette.png`)
  const gifPath = path.join(workDir, `demo-${language}.gif`)
  await writeFile(assPath, assDocument(language, flow), "utf8")
  const escapedAss = assPath.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'")
  const fonts = resolveFontsDir().replaceAll(":", "\\:").replaceAll("'", "\\'")
  const source = `color=c=0x0d1117:s=${WIDTH}x${HEIGHT}:r=${FPS}:d=${DURATION}`
  const filter = `drawbox=x=0:y=54:w=iw:h=1:color=0xe85d75:t=fill,ass=filename='${escapedAss}':fontsdir='${fonts}'`
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", source, "-vf", `${filter},palettegen=max_colors=64:reserve_transparent=0:stats_mode=diff`, "-frames:v", "1", palettePath])
  run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", source, "-i", palettePath, "-lavfi", `[0:v]${filter}[terminal];[terminal][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`, "-loop", "0", gifPath])
  if ((await stat(gifPath)).size < 10_000) fail(`${path.basename(gifPath)} is unexpectedly small`)
  return gifPath
}

async function publishOrCheck(generated, language, check) {
  const target = path.join(assetsDir, `demo-${language}.gif`)
  if (!check) {
    await copyFile(generated, target)
    return
  }
  const [actual, expected] = await Promise.all([readFile(generated), readFile(target)])
  if (!actual.equals(expected)) fail(`${path.relative(repositoryRoot, target)} is stale; run npm run demos`)
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const check = args.delete("--check")
  if (args.size) fail(`unsupported option: ${[...args][0]}`)
  run("ffmpeg", ["-hide_banner", "-h", "filter=ass"])
  const workDir = await mkdtemp(path.join(tmpdir(), "opencode-see-demo-"))
  try {
    const flow = await captureRealFlow(workDir)
    for (const language of Object.keys(translations)) {
      const generated = await render(language, flow, workDir)
      await publishOrCheck(generated, language, check)
      console.log(`${check ? "verified" : "generated"}: assets/demo-${language}.gif`)
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

try {
  await main()
} catch (error) {
  console.error(`opencode-see demo generation failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
