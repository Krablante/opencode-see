import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import {
  DEFAULT_DELEGATE_DELETE_AFTER,
  DEFAULT_DELEGATE_ENABLED,
  DEFAULT_DELEGATE_MODEL_ID,
  DEFAULT_DELEGATE_PROMPT,
  DEFAULT_DELEGATE_PROVIDER_ID,
  DEFAULT_DELEGATE_TIMEOUT_MS,
  DEFAULT_SCREENSHOT_DIR,
  DEFAULT_SCREENSHOT_TIMEOUT_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_VIRTUAL_TIME_BUDGET_MS,
} from "./constants.js"
import { expandHome } from "./view.js"

export const CONFIG_FILENAME = "opencode-see.json"

export type SeeConfig = {
  screenshotDirectory: string
  screenshotRoot: string
  chromiumPath?: string
  viewport: { width: number; height: number }
  virtualTimeBudgetMs: number
  screenshotTimeoutMs: number
  visionDelegate: VisionDelegateConfig
  configPath: string
}

export type VisionDelegateConfig = {
  enabled: boolean
  providerID: string
  modelID: string
  prompt: string
  timeoutMs: number
  deleteAfter: boolean
}

type ConfigFile = {
  screenshotDirectory?: unknown
  chromiumPath?: unknown
  viewport?: { width?: unknown; height?: unknown } | unknown
  virtualTimeBudgetMs?: unknown
  screenshotTimeoutMs?: unknown
  visionDelegate?: unknown
}

export function defaultConfigPath(
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.OPENCODE_SEE_CONFIG) return resolve(expandHome(env.OPENCODE_SEE_CONFIG, home))
  if (env.OPENCODE_CONFIG_DIR) return resolve(env.OPENCODE_CONFIG_DIR, CONFIG_FILENAME)
  if (platform === "win32" && env.APPDATA) return resolve(env.APPDATA, "opencode", CONFIG_FILENAME)
  return resolve(env.XDG_CONFIG_HOME ?? join(home, ".config"), "opencode", CONFIG_FILENAME)
}

async function readConfigFile(path: string): Promise<ConfigFile> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as ConfigFile
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}
    if (error instanceof SyntaxError) throw new Error(`Invalid JSON in opencode-see config: ${path}`)
    throw error
  }
}

function nonEmptyString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string`)
  return value
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback
  const number = typeof value === "string" ? Number(value) : value
  if (!Number.isInteger(number) || Number(number) < 1) throw new Error(`${label} must be a positive integer`)
  return Number(number)
}

function booleanValue(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    if (["1", "true", "yes", "on"].includes(normalized)) return true
    if (["0", "false", "no", "off"].includes(normalized)) return false
  }
  throw new Error(`${label} must be a boolean`)
}

export async function loadConfig(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): Promise<SeeConfig> {
  const configPath = defaultConfigPath(env, home, platform)
  const file = await readConfigFile(configPath)
  const screenshotDirectory =
    nonEmptyString(env.OPENCODE_SEE_SCREENSHOT_DIRECTORY, "OPENCODE_SEE_SCREENSHOT_DIRECTORY") ??
    nonEmptyString(file.screenshotDirectory, `screenshotDirectory in ${configPath}`) ??
    DEFAULT_SCREENSHOT_DIR
  const expandedDirectory = expandHome(screenshotDirectory, home)
  const screenshotRoot = isAbsolute(expandedDirectory)
    ? resolve(expandedDirectory)
    : resolve(directory, expandedDirectory)
  const configuredChromium =
    nonEmptyString(env.OPENCODE_SEE_CHROMIUM, "OPENCODE_SEE_CHROMIUM") ??
    nonEmptyString(file.chromiumPath, `chromiumPath in ${configPath}`)
  const chromiumPath = configuredChromium ? resolveChromiumOverride(configuredChromium, directory, home) : undefined
  const viewport: { width?: unknown; height?: unknown } =
    file.viewport && typeof file.viewport === "object" && !Array.isArray(file.viewport)
      ? file.viewport
      : {}
  const visionDelegate: Record<string, unknown> =
    file.visionDelegate && typeof file.visionDelegate === "object" && !Array.isArray(file.visionDelegate)
      ? file.visionDelegate as Record<string, unknown>
      : {}
  return {
    screenshotDirectory,
    screenshotRoot,
    chromiumPath,
    viewport: {
      width: positiveInteger(env.OPENCODE_SEE_VIEWPORT_WIDTH ?? viewport.width, DEFAULT_VIEWPORT.width, "viewport width"),
      height: positiveInteger(env.OPENCODE_SEE_VIEWPORT_HEIGHT ?? viewport.height, DEFAULT_VIEWPORT.height, "viewport height"),
    },
    virtualTimeBudgetMs: positiveInteger(
      env.OPENCODE_SEE_VIRTUAL_TIME_BUDGET_MS ?? file.virtualTimeBudgetMs,
      DEFAULT_VIRTUAL_TIME_BUDGET_MS,
      "virtualTimeBudgetMs",
    ),
    screenshotTimeoutMs: positiveInteger(
      env.OPENCODE_SEE_SCREENSHOT_TIMEOUT_MS ?? file.screenshotTimeoutMs,
      DEFAULT_SCREENSHOT_TIMEOUT_MS,
      "screenshotTimeoutMs",
    ),
    visionDelegate: {
      enabled: booleanValue(
        env.OPENCODE_SEE_DELEGATE_ENABLED ?? visionDelegate.enabled,
        DEFAULT_DELEGATE_ENABLED,
        "visionDelegate.enabled",
      ),
      providerID:
        nonEmptyString(env.OPENCODE_SEE_DELEGATE_PROVIDER_ID, "OPENCODE_SEE_DELEGATE_PROVIDER_ID") ??
        nonEmptyString(visionDelegate.providerID, `visionDelegate.providerID in ${configPath}`) ??
        DEFAULT_DELEGATE_PROVIDER_ID,
      modelID:
        nonEmptyString(env.OPENCODE_SEE_DELEGATE_MODEL_ID, "OPENCODE_SEE_DELEGATE_MODEL_ID") ??
        nonEmptyString(visionDelegate.modelID, `visionDelegate.modelID in ${configPath}`) ??
        DEFAULT_DELEGATE_MODEL_ID,
      prompt:
        nonEmptyString(env.OPENCODE_SEE_DELEGATE_PROMPT, "OPENCODE_SEE_DELEGATE_PROMPT") ??
        nonEmptyString(visionDelegate.prompt, `visionDelegate.prompt in ${configPath}`) ??
        DEFAULT_DELEGATE_PROMPT,
      timeoutMs: positiveInteger(
        env.OPENCODE_SEE_DELEGATE_TIMEOUT_MS ?? visionDelegate.timeoutMs,
        DEFAULT_DELEGATE_TIMEOUT_MS,
        "visionDelegate.timeoutMs",
      ),
      deleteAfter: booleanValue(
        env.OPENCODE_SEE_DELEGATE_DELETE_AFTER ?? visionDelegate.deleteAfter,
        DEFAULT_DELEGATE_DELETE_AFTER,
        "visionDelegate.deleteAfter",
      ),
    },
    configPath,
  }
}

function resolveChromiumOverride(value: string, directory: string, home: string): string {
  const expanded = expandHome(value, home)
  if (isAbsolute(expanded)) return resolve(expanded)
  if (expanded.includes("/") || expanded.includes("\\")) return resolve(directory, expanded)
  return expanded
}
