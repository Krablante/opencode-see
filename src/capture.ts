import { spawn, type ChildProcess } from "node:child_process"
import { accessSync, constants as fsConstants } from "node:fs"
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { homedir, platform as osPlatform, tmpdir } from "node:os"
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from "node:path"
import type { SeeConfig } from "./config.js"
import { USER_AGENT } from "./constants.js"

export type CaptureBackend = "cdp" | "cli"
export type ScreenshotResult = {
  absolutePath: string
  filename: string
  bytes: Buffer
  backend: CaptureBackend
  width: number
  height: number
}

export type CaptureOptions = {
  url: string
  outputPath?: string
  width?: number
  height?: number
  config: SeeConfig
  signal?: AbortSignal
  home?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}

export class CaptureUnavailableError extends Error {}

type SpawnBrowser = typeof spawn
type CdpReply = { id?: number; result?: Record<string, unknown>; error?: { message?: string }; method?: string; params?: unknown }

function executableFromPath(name: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string | undefined {
  const pathValue = env.PATH ?? ""
  const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`)
      try {
        accessSync(candidate, fsConstants.X_OK)
        return candidate
      } catch {}
    }
  }
  return undefined
}

export async function findChromium(
  configured?: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = osPlatform(),
): Promise<string | undefined> {
  const candidates = [
    configured,
    env.OPENCODE_SEE_CHROMIUM,
    "chromium-browser",
    "google-chrome",
    platform === "linux" ? join(home, "snap", "bin", "chromium") : undefined,
    platform === "linux" ? "/snap/bin/chromium" : undefined,
    "chromium",
    platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined,
    platform === "win32" && env.PROGRAMFILES ? join(env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe") : undefined,
  ].filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) && !candidate.includes("/") && !candidate.includes("\\")) {
      const found = executableFromPath(candidate, env, platform)
      if (found) return found
      continue
    }
    try {
      await access(candidate, fsConstants.X_OK)
      return candidate
    } catch {}
  }
  return undefined
}

export function isSnapChromium(browserPath: string): boolean {
  return browserPath.includes("/snap/") || basename(browserPath) === "chromium-browser"
}

function installationMessage(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "No Chromium-based browser was found. Install Google Chrome, or set OPENCODE_SEE_CHROMIUM to its executable."
  if (platform === "win32") return "No Chromium-based browser was found. Install Microsoft Edge or Google Chrome, or set OPENCODE_SEE_CHROMIUM."
  return "No Chromium-based browser was found. Install it (Ubuntu/Debian: sudo apt install chromium-browser; Fedora: sudo dnf install chromium), or set OPENCODE_SEE_CHROMIUM to the executable."
}

function validateUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`Invalid screenshot URL: ${value}`)
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("screenshot supports http:// and https:// URLs only")
  }
  return url.toString()
}

function outputTarget(root: string, requested?: string): string {
  const name = requested ?? `screenshot-${new Date().toISOString().replaceAll(/[:.]/g, "-")}.png`
  if (isAbsolute(name)) throw new Error("output_path must be relative to the screenshot directory")
  const withExtension = name.toLowerCase().endsWith(".png") ? name : `${name}.png`
  const target = resolve(root, withExtension)
  const distance = relative(root, target)
  if (distance.startsWith("..") || isAbsolute(distance)) throw new Error("output_path escapes the screenshot directory")
  return target
}

async function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw signal.reason ?? new Error("Screenshot cancelled")
  await new Promise<void>((resolveWait, reject) => {
    const aborted = () => {
      clearTimeout(timer)
      reject(signal?.reason ?? new Error("Screenshot cancelled"))
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", aborted)
      resolveWait()
    }, delayMs)
    signal?.addEventListener("abort", aborted, { once: true })
  })
}

async function profileRoot(browserPath: string, home: string, env: NodeJS.ProcessEnv): Promise<string> {
  if (isSnapChromium(browserPath)) {
    const root = env.SNAP_USER_COMMON ?? join(home, "snap", "chromium", "common")
    await mkdir(root, { recursive: true })
    return root
  }
  return tmpdir()
}

async function readDevToolsPort(profile: string, deadline: number, signal?: AbortSignal): Promise<number> {
  const activePort = join(profile, "DevToolsActivePort")
  while (Date.now() < deadline) {
    try {
      const [line] = (await readFile(activePort, "utf8")).split("\n")
      const port = Number(line)
      if (Number.isInteger(port) && port > 0) return port
    } catch {}
    await wait(50, signal)
  }
  throw new Error("Chromium did not expose a CDP port before the timeout")
}

class CdpClient {
  private nextId = 1
  private pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private events = new Map<string, Array<() => void>>()

  constructor(private socket: WebSocket, private commandTimeoutMs: number) {
    socket.addEventListener("message", (event) => {
      const reply = JSON.parse(String(event.data)) as CdpReply
      if (reply.id) {
        const pending = this.pending.get(reply.id)
        if (!pending) return
        this.pending.delete(reply.id)
        clearTimeout(pending.timer)
        if (reply.error) pending.reject(new Error(reply.error.message ?? "CDP command failed"))
        else pending.resolve(reply.result ?? {})
        return
      }
      if (reply.method) {
        for (const resolveEvent of this.events.get(reply.method) ?? []) resolveEvent()
        this.events.delete(reply.method)
      }
    })
  }

  async open(timeoutMs: number): Promise<void> {
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolveOpen, reject) => {
      const timer = setTimeout(() => reject(new Error("CDP WebSocket connection timed out")), timeoutMs)
      this.socket.addEventListener("open", () => { clearTimeout(timer); resolveOpen() }, { once: true })
      this.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error("CDP WebSocket connection failed")) }, { once: true })
    })
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`${method} timed out`))
      }, this.commandTimeoutMs)
      this.pending.set(id, { resolve: resolveCommand, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  event(method: string, timeoutMs: number): Promise<void> {
    return new Promise((resolveEvent, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
      const listeners = this.events.get(method) ?? []
      listeners.push(() => { clearTimeout(timer); resolveEvent() })
      this.events.set(method, listeners)
    })
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error("CDP connection closed"))
    }
    this.pending.clear()
    this.socket.close()
  }
}

async function stopBrowser(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGTERM")
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    wait(1_000).then(() => { if (child.exitCode === null) child.kill("SIGKILL") }),
  ])
}

async function captureCdp(
  browserPath: string,
  url: string,
  width: number,
  height: number,
  timeoutMs: number,
  virtualTimeBudgetMs: number,
  signal: AbortSignal | undefined,
  home: string,
  env: NodeJS.ProcessEnv,
  spawnBrowser: SpawnBrowser = spawn,
): Promise<Buffer> {
  const root = await profileRoot(browserPath, home, env)
  const profile = await mkdtemp(join(root, "opencode-see-cdp-"))
  const child = spawnBrowser(browserPath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: "ignore", env })
  const deadline = Date.now() + timeoutMs
  let client: CdpClient | undefined
  try {
    const port = await Promise.race([
      readDevToolsPort(profile, deadline, signal),
      new Promise<number>((_resolvePort, reject) => {
        child.once("error", reject)
        child.once("exit", (code, exitSignal) => {
          reject(new Error(`Chromium exited before CDP was ready (${code ?? exitSignal ?? "unknown"})`))
        })
      }),
    ])
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
      headers: { "User-Agent": USER_AGENT },
      signal,
    }).then((response) => {
      if (!response.ok) throw new Error(`CDP target discovery failed (${response.status})`)
      return response.json() as Promise<Array<{ type: string; webSocketDebuggerUrl?: string }>>
    })
    const endpoint = targets.find((target) => target.type === "page")?.webSocketDebuggerUrl
    if (!endpoint) throw new Error("Chromium did not expose a page target")
    const remaining = Math.max(1, deadline - Date.now())
    client = new CdpClient(new WebSocket(endpoint), remaining)
    await client.open(remaining)
    await client.send("Page.enable")
    await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
    const loaded = client.event("Page.loadEventFired", remaining)
    await client.send("Page.navigate", { url })
    await loaded
    await wait(Math.min(virtualTimeBudgetMs, Math.max(0, deadline - Date.now())), signal)
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
    })
    if (typeof result.data !== "string") throw new Error("CDP screenshot response did not contain image data")
    return Buffer.from(result.data, "base64")
  } finally {
    client?.close()
    await stopBrowser(child)
    await rm(profile, { recursive: true, force: true })
  }
}

export function cliScratchPath(
  finalPath: string,
  browserPath: string,
  home: string = homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const base = isSnapChromium(browserPath)
    ? (env.SNAP_USER_COMMON ?? join(home, "snap", "chromium", "common"))
    : dirname(finalPath)
  return join(base, `.opencode-see-${process.pid}-${Date.now()}.png`)
}

async function captureCli(
  browserPath: string,
  url: string,
  finalPath: string,
  width: number,
  height: number,
  virtualTimeBudgetMs: number,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  home: string,
  env: NodeJS.ProcessEnv,
  spawnBrowser: SpawnBrowser = spawn,
): Promise<Buffer> {
  const scratch = cliScratchPath(finalPath, browserPath, home, env)
  await mkdir(dirname(scratch), { recursive: true })
  const child = spawnBrowser(browserPath, [
    "--headless=new",
    "--disable-gpu",
    `--screenshot=${scratch}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${virtualTimeBudgetMs}`,
    url,
  ], { stdio: "ignore", env })
  try {
    await new Promise<void>((resolveExit, reject) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("Chromium CLI screenshot timed out")) }, timeoutMs)
      signal?.addEventListener("abort", () => { child.kill("SIGTERM"); reject(signal.reason ?? new Error("Screenshot cancelled")) }, { once: true })
      child.once("error", reject)
      child.once("exit", (code) => {
        clearTimeout(timer)
        if (code === 0) resolveExit()
        else reject(new Error(`Chromium CLI screenshot failed with exit code ${code}`))
      })
    })
    const bytes = await readFile(scratch)
    if (scratch !== finalPath) await copyFile(scratch, finalPath)
    return bytes
  } finally {
    await rm(scratch, { force: true })
  }
}

export async function captureScreenshot(options: CaptureOptions): Promise<ScreenshotResult> {
  const env = options.env ?? process.env
  const home = options.home ?? homedir()
  const platform = options.platform ?? osPlatform()
  const url = validateUrl(options.url)
  const width = options.width ?? options.config.viewport.width
  const height = options.height ?? options.config.viewport.height
  if (!Number.isInteger(width) || width < 1 || !Number.isInteger(height) || height < 1) {
    throw new Error("Screenshot width and height must be positive integers")
  }
  const browserPath = await findChromium(options.config.chromiumPath, env, home, platform)
  if (!browserPath) throw new CaptureUnavailableError(installationMessage(platform))
  const absolutePath = outputTarget(options.config.screenshotRoot, options.outputPath)
  await mkdir(dirname(absolutePath), { recursive: true })
  try {
    await access(absolutePath)
    throw new Error(`Screenshot output already exists: ${absolutePath}`)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  let bytes: Buffer
  let backend: CaptureBackend = "cdp"
  try {
    bytes = await captureCdp(
      browserPath,
      url,
      width,
      height,
      options.config.screenshotTimeoutMs,
      options.config.virtualTimeBudgetMs,
      options.signal,
      home,
      env,
    )
  } catch (error) {
    if (isSnapChromium(browserPath)) {
      throw new Error(`CDP screenshot failed for snap Chromium; CLI fallback is disabled because snap has a private /tmp: ${error instanceof Error ? error.message : String(error)}`)
    }
    backend = "cli"
    bytes = await captureCli(
      browserPath,
      url,
      absolutePath,
      width,
      height,
      options.config.virtualTimeBudgetMs,
      options.config.screenshotTimeoutMs,
      options.signal,
      home,
      env,
    )
  }
  if (backend === "cdp") await writeFile(absolutePath, bytes, { flag: "wx" })
  return { absolutePath, filename: basename(absolutePath), bytes, backend, width, height }
}
