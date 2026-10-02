# Configuration

[English](./configuration.md) · [Русский](./configuration.ru.md) · [Home](../README.md)

## Where settings live

The plugin reads one JSON file on each tool call. A missing file means defaults;
invalid JSON or malformed setting objects produce an error. Environment values
override file values. You can change plugin settings without restarting the
host; changing the host's plugin list still requires a restart.

The path is selected in this order; these are alternatives, not merged files:

1. `OPENCODE_SEE_CONFIG`, with `~/` expansion.
2. `$OPENCODE_CONFIG_DIR/opencode-see.json`.
3. On Windows with `APPDATA`: `%APPDATA%/opencode/opencode-see.json`.
4. Else: `$XDG_CONFIG_HOME/opencode/opencode-see.json`, or
   `~/.config/opencode/opencode-see.json` when XDG is unset.

For OpenCodez, set `OPENCODE_CONFIG_DIR` to its config directory or set the
explicit `OPENCODE_SEE_CONFIG` path if your launcher does not already do so.
Relative explicit config paths resolve from the host process's working directory.

## Settings

[examples/opencode-see.json](../examples/opencode-see.json) contains the portable
defaults. Supply only fields you need to change; omit `chromiumPath` for automatic
browser discovery.

| Field | Default | Meaning |
| --- | --- | --- |
| `screenshotDirectory` | `.opencode/screenshots` | Relative to the active project; absolute and `~/` paths also work |
| `chromiumPath` | automatic | Executable path or command on PATH; an invalid explicit choice fails without substituting a browser |
| `viewport.width`, `viewport.height` | `1440`, `900` | Default dimensions; tool arguments take precedence |
| `virtualTimeBudgetMs` | `2000` | Real wait after page load in CDP; virtual-time budget in CLI |
| `screenshotTimeoutMs` | `30000` | One deadline for CDP and any CLI fallback |
| `visionDelegate.enabled` | `true` | Allow delegation |
| `visionDelegate.model` | `opencode-go/gpt-5.6-luna` | Exact `provider/model` reference |
| `visionDelegate.forceFor` | `[]` | Exact active model references that must delegate |
| `visionDelegate.prompt` | `Опиши содержимое каждой приложенной картинки подробно и по делу.` | Baseline visual question, supplemented by the tool's `question` |
| `visionDelegate.timeoutMs` | `90000` | Combined budget for creating the session and requesting an answer |
| `visionDelegate.deleteAfter` | `true` | Delete the delegate session after completion or failure |

Dimensions and time budgets must be positive integers no greater than
2,147,483,647. A viewport must fit the separate 32 megapixel capture limit.
Neither image-size nor viewport limits are expanded by increasing a timeout.

## Choose the vision route

Native image input is the default for models declaring image capability.
Text-only models delegate automatically. `forceFor` also delegates the listed
native models; matching is exact, without wildcards.

```json
{
  "visionDelegate": {
    "model": "your-provider/your-vision-model",
    "forceFor": ["your-provider/your-caller-model"]
  }
}
```

Choose the model ID shown by `opencode models` or `opencodez models`. Any provider
registered with that host is accepted. The first `/` separates provider and
model; additional slashes belong to the model ID. Authenticate the provider in
OpenCode first and choose a model that accepts images. The plugin never replaces
your choice with another model. The default Go model requires access to that
provider; it is not a free fallback.

`forceFor` affects `image_view` and `screenshot` results. It does not rewrite
images attached directly to user messages. Text-only models receive a system
hint to call `image_view` for chat images; native models do not receive that hint.
With delegation disabled, callers requiring it get an explicit explanation and
no binary attachment.

Delegate sessions cannot use tools. Cancellation or timeout also requests a
server-side session abort, even with `deleteAfter: false`. Cleanup has its own
bounded requests and can add time after the answer deadline. Retained sessions
contain image data and count toward host storage; delete them when no longer
needed. Failed cleanup is logged by the host.

## Environment overrides

| Variable | Field |
| --- | --- |
| `OPENCODE_SEE_SCREENSHOT_DIRECTORY` | `screenshotDirectory` |
| `OPENCODE_SEE_CHROMIUM` | `chromiumPath` |
| `OPENCODE_SEE_VIEWPORT_WIDTH` | `viewport.width` |
| `OPENCODE_SEE_VIEWPORT_HEIGHT` | `viewport.height` |
| `OPENCODE_SEE_VIRTUAL_TIME_BUDGET_MS` | `virtualTimeBudgetMs` |
| `OPENCODE_SEE_SCREENSHOT_TIMEOUT_MS` | `screenshotTimeoutMs` |
| `OPENCODE_SEE_DELEGATE_ENABLED` | `visionDelegate.enabled` |
| `OPENCODE_SEE_DELEGATE_MODEL` | `visionDelegate.model` |
| `OPENCODE_SEE_DELEGATE_PROMPT` | `visionDelegate.prompt` |
| `OPENCODE_SEE_DELEGATE_TIMEOUT_MS` | `visionDelegate.timeoutMs` |
| `OPENCODE_SEE_DELEGATE_DELETE_AFTER` | `visionDelegate.deleteAfter` |

Boolean environment values accept `true`/`false`, `1`/`0`, `yes`/`no`, and
`on`/`off`. `forceFor` is configured in the JSON file.

Legacy `visionDelegate.providerID` and `modelID`, plus
`OPENCODE_SEE_DELEGATE_PROVIDER_ID` and `OPENCODE_SEE_DELEGATE_MODEL_ID`, remain
accepted. New settings should use `model`. Within the file, `model` wins over
the split fields. The environment's `OPENCODE_SEE_DELEGATE_MODEL` wins over all
model fields; otherwise split environment fields override their file values.
