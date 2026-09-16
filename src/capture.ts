import { spawn, type ChildProcess } from "node:child_process"
import { once } from "node:events"
import { accessSync, constants as fsConstants } from "node:fs"
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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

async function readDevToolsPort(profile: string, signal: AbortSignal): Promise<number> {
  const activePort = join(profile, "DevToolsActivePort")
  while (true) {
    signal.throwIfAborted()
    try {
      const [line] = (await readFile(activePort, "utf8")).split("\n")
      const port = Number(line)
      if (Number.isInteger(port) && port > 0) return port
    } catch {}
    await wait(50, signal)
  }
}

class CdpClient {
  private nextId = 1
  private pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void
    reject: (error: Error) => void
  }>()
  private events = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
  private opening?: { resolve: () => void; reject: (error: Error) => void }
  private failure?: Error
  private aborted = () => this.close(this.signal.reason)

  constructor(private socket: WebSocket, private signal: AbortSignal) {
    socket.addEventListener("open", () => {
      this.opening?.resolve()
      this.opening = undefined
    })
    socket.addEventListener("error", () => this.close(new Error("CDP WebSocket connection failed")))
    socket.addEventListener("close", () => this.close())
    socket.addEventListener("message", (event) => {
      let reply: CdpReply
      try {
        reply = JSON.parse(String(event.data)) as CdpReply
      } catch {
        this.close(new Error("Invalid CDP response"))
        return
      }
      if (reply.id) {
        const pending = this.pending.get(reply.id)
        if (!pending) return
        this.pending.delete(reply.id)
        if (reply.error) pending.reject(new Error(reply.error.message ?? "CDP command failed"))
        else pending.resolve(reply.result ?? {})
        return
      }
      if (reply.method) {
        this.events.get(reply.method)?.resolve()
        this.events.delete(reply.method)
      }
    })
    signal.addEventListener("abort", this.aborted, { once: true })
    if (signal.aborted) this.aborted()
  }

  async open(): Promise<void> {
    if (this.failure) throw this.failure
    if (this.socket.readyState === WebSocket.OPEN) return
    await new Promise<void>((resolveOpen, reject) => {
      this.opening = { resolve: resolveOpen, reject }
    })
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (this.failure) throw this.failure
    const id = this.nextId++
    return new Promise((resolveCommand, reject) => {
      this.pending.set(id, { resolve: resolveCommand, reject })
      try {
        this.socket.send(JSON.stringify({ id, method, params }))
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  async event(method: string): Promise<void> {
    if (this.failure) throw this.failure
    return new Promise((resolveEvent, reject) => {
      this.events.set(method, { resolve: resolveEvent, reject })
    })
  }

  close(error: Error = new Error("CDP connection closed")): void {
    if (this.failure) return
    this.failure = error
    this.signal.removeEventListener("abort", this.aborted)
    this.opening?.reject(error)
    this.opening = undefined
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    for (const event of this.events.values()) event.reject(error)
    this.events.clear()
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close()
  }
}

async function stopBrowser(child: ChildProcess): Promise<void> {
  if (!child.pid) return
  if (child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((resolveExit) => {
      const timer = setTimeout(() => signalBrowser(child, "SIGKILL"), 1_000)
      child.once("exit", () => { clearTimeout(timer); resolveExit() })
      signalBrowser(child, "SIGTERM")
    })
  }
  // The launcher can exit before its children finish writing the profile.
  if (process.platform !== "win32") signalBrowser(child, "SIGKILL")
}

function signalBrowser(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    if (process.platform === "win32") child.kill(signal)
    else process.kill(-child.pid!, signal)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
  }
}

async function captureCdp(
  browserPath: string,
  url: string,
  width: number,
  height: number,
  virtualTimeBudgetMs: number,
  signal: AbortSignal,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<Buffer> {
  const root = await profileRoot(browserPath, home, env)
  const profile = await mkdtemp(join(root, "opencode-see-cdp-"))
  const lifecycle = new AbortController()
  const active = AbortSignal.any([signal, lifecycle.signal])
  let child: ChildProcess | undefined
  let client: CdpClient | undefined
  try {
    active.throwIfAborted()
    child = spawn(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--remote-debugging-address=127.0.0.1",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ], { stdio: "ignore", env, detached: process.platform !== "win32" })
    child.once("error", (error) => lifecycle.abort(error))
    child.once("exit", (code, exitSignal) => {
      lifecycle.abort(new Error(`Chromium exited during CDP capture (${code ?? exitSignal ?? "unknown"})`))
    })
    const port = await readDevToolsPort(profile, active)
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, {
      headers: { "User-Agent": USER_AGENT },
      signal: active,
    }).then((response) => {
      if (!response.ok) throw new Error(`CDP target discovery failed (${response.status})`)
      return response.json() as Promise<Array<{ type: string; webSocketDebuggerUrl?: string }>>
    })
    const endpoint = targets.find((target) => target.type === "page")?.webSocketDebuggerUrl
    if (!endpoint) throw new Error("Chromium did not expose a page target")
    active.throwIfAborted()
    client = new CdpClient(new WebSocket(endpoint), active)
    await client.open()
    await client.send("Page.enable")
    await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
    await Promise.all([
      client.event("Page.loadEventFired"),
      client.send("Page.navigate", { url }).then((result) => {
        if (result.errorText) throw new Error(`Chromium navigation failed: ${result.errorText}`)
      }),
    ])
    await wait(virtualTimeBudgetMs, active)
    const result = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: true,
    })
    if (typeof result.data !== "string") throw new Error("CDP screenshot response did not contain image data")
    return Buffer.from(result.data, "base64")
  } finally {
    lifecycle.abort(new Error("CDP capture finished"))
    client?.close()
    if (child) await stopBrowser(child)
    await rm(profile, { recursive: true, force: true })
  }
}

async function captureCli(
  browserPath: string,
  url: string,
  width: number,
  height: number,
  virtualTimeBudgetMs: number,
  signal: AbortSignal,
  home: string,
  env: NodeJS.ProcessEnv,
): Promise<Buffer> {
  const profile = await mkdtemp(join(await profileRoot(browserPath, home, env), "opencode-see-cli-"))
  const scratch = join(profile, "screenshot.png")
  let child: ChildProcess | undefined
  try {
    signal.throwIfAborted()
    child = spawn(browserPath, [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `--screenshot=${scratch}`,
      `--window-size=${width},${height}`,
      `--virtual-time-budget=${virtualTimeBudgetMs}`,
      url,
    ], { stdio: "ignore", env, detached: process.platform !== "win32" })
    const [code, exitSignal] = await once(child, "exit", { signal })
    if (code !== 0) throw new Error(`Chromium CLI screenshot failed (${code ?? exitSignal})`)
    return await readFile(scratch, { signal })
  } finally {
    if (child) await stopBrowser(child)
    await rm(profile, { recursive: true, force: true })
  }
}

export async function captureScreenshot(options: CaptureOptions): Promise<ScreenshotResult> {
  options.signal?.throwIfAborted()
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
  const timeout = new AbortController()
  const timer = setTimeout(
    () => timeout.abort(new Error(`Screenshot timed out after ${options.config.screenshotTimeoutMs} ms`)),
    options.config.screenshotTimeoutMs,
  )
  const signal = options.signal ? AbortSignal.any([options.signal, timeout.signal]) : timeout.signal
  try {
    signal.throwIfAborted()
    try {
      bytes = await captureCdp(
        browserPath,
        url,
        width,
        height,
        options.config.virtualTimeBudgetMs,
        signal,
        home,
        env,
      )
    } catch (error) {
      signal.throwIfAborted()
      if (isSnapChromium(browserPath)) {
        throw new Error(`CDP screenshot failed for snap Chromium; CLI fallback is disabled because snap has a private /tmp: ${error instanceof Error ? error.message : String(error)}`)
      }
      backend = "cli"
      bytes = await captureCli(
        browserPath,
        url,
        width,
        height,
        options.config.virtualTimeBudgetMs,
        signal,
        home,
        env,
      )
    }
    signal.throwIfAborted()
    await writeFile(absolutePath, bytes, { flag: "wx" })
    return { absolutePath, filename: basename(absolutePath), bytes, backend, width, height }
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    clearTimeout(timer)
  }
}
