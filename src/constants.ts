export const DEFAULT_SCREENSHOT_DIR = ".opencode/screenshots"
export const DEFAULT_VIEWPORT = { width: 1440, height: 900 } as const
export const DEFAULT_VIRTUAL_TIME_BUDGET_MS = 2_000
export const DEFAULT_SCREENSHOT_TIMEOUT_MS = 30_000
export const DEFAULT_DELEGATE_ENABLED = true
export const DEFAULT_DELEGATE_MODEL = "opencode-go/gpt-5.6-luna"
export const DEFAULT_DELEGATE_PROMPT = "Опиши содержимое каждой приложенной картинки подробно и по делу."
export const DEFAULT_DELEGATE_TIMEOUT_MS = 90_000
export const DEFAULT_DELEGATE_DELETE_AFTER = true
export const MAX_IMAGES = 5
export const CORE_RESIZE_DIMENSION = 2_000
export const CORE_RESIZE_BASE64_BYTES = 5 * 1024 * 1024
export const USER_AGENT = "opencode-see/0.4.0"

export const SUPPORTED_IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const
export type SupportedImageMime = (typeof SUPPORTED_IMAGE_MIMES)[number]
