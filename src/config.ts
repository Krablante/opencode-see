import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join, resolve } from "node:path"
import {
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
  configPath: string
}

type ConfigFile = {
  screenshotDirectory?: unknown
  chromiumPath?: unknown
  viewport?: { width?: unknown; height?: unknown } | unknown
  virtualTimeBudgetMs?: unknown
  screenshotTimeoutMs?: unknown
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
    configPath,
  }
}

function resolveChromiumOverride(value: string, directory: string, home: string): string {
  const expanded = expandHome(value, home)
  if (isAbsolute(expanded)) return resolve(expanded)
  if (expanded.includes("/") || expanded.includes("\\")) return resolve(directory, expanded)
  return expanded
}
