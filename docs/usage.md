# Usage

## `image_view`

```json
{
  "paths": ["./diagram.png", "~/Pictures/reference.webp"]
}
```

`paths` accepts one to five values. Each may be absolute, relative to the
active OpenCode directory, or home-relative with `~/`. Supported signatures are
PNG, JPEG, WebP, and GIF. PDF is intentionally unsupported.

For a vision-capable active model, the result contains one file attachment per
path and a text block like:

```text
Image metadata:
1. path=/work/project/diagram.png | mime=image/png | bytes=48211 | dimensions=1600×900 | core_resize=no
```

`core_resize=yes` means the attachment exceeds the known OpenCode image resize
threshold of 2000 pixels on one side or 5 MiB of base64 data. The plugin reports
that fact but leaves resizing to the core.

For a text-only active model, the same metadata is followed by `Vision via
<modelID>:` and the configured delegate's description. The original attachments
are omitted from that tool result so unsupported binary data is not sent to the
text-only model.

### Long sessions

Image tools need no special workflow in long sessions. If a compatible host
performs remote mid-turn compaction before the model receives the tool result,
`opencode-see` restores the latest batch for the immediate continuation. The
replay is automatic, invisible in session history, and limited to five images.

This path is selected from the completed compaction marker itself. It performs
no separate model, provider, auth, or config lookup and stays inactive for
ordinary OpenCode, local or legacy compaction, other providers, and turns that
did not compact. No configuration is required.

## `screenshot`

```json
{
  "url": "http://localhost:3000",
  "output_path": "home.png",
  "width": 1440,
  "height": 900
}
```

Only HTTP and HTTPS URLs are accepted. `output_path` is relative to the
configured screenshot directory and cannot escape it. `.png` is added when
omitted. Width and height are positive integer viewport dimensions; CDP capture
may include page content beyond the viewport.

## Configuration

Create `opencode-see.json` in the active OpenCode config directory:

```json
{
  "screenshotDirectory": ".opencode/screenshots",
  "chromiumPath": "/usr/bin/chromium",
  "viewport": { "width": 1440, "height": 900 },
  "virtualTimeBudgetMs": 2000,
  "screenshotTimeoutMs": 30000,
  "visionDelegate": {
    "enabled": true,
    "providerID": "opencode-go",
    "modelID": "gpt-5.6-luna",
    "prompt": "Опиши содержимое каждой приложенной картинки подробно и по делу.",
    "timeoutMs": 90000,
    "deleteAfter": true
  }
}
```

Relative screenshot directories resolve from the active project; absolute and
`~/` directories are supported. Config is loaded on every call.

Config lookup order:

1. `OPENCODE_SEE_CONFIG`;
2. `$OPENCODE_CONFIG_DIR/opencode-see.json`;
3. `$XDG_CONFIG_HOME/opencode/opencode-see.json`;
4. `~/.config/opencode/opencode-see.json`;
5. `%APPDATA%/opencode/opencode-see.json` on Windows.

Environment overrides:

| Variable | Config field |
| --- | --- |
| `OPENCODE_SEE_SCREENSHOT_DIRECTORY` | `screenshotDirectory` |
| `OPENCODE_SEE_CHROMIUM` | `chromiumPath` |
| `OPENCODE_SEE_VIEWPORT_WIDTH` | `viewport.width` |
| `OPENCODE_SEE_VIEWPORT_HEIGHT` | `viewport.height` |
| `OPENCODE_SEE_VIRTUAL_TIME_BUDGET_MS` | `virtualTimeBudgetMs` |
| `OPENCODE_SEE_SCREENSHOT_TIMEOUT_MS` | `screenshotTimeoutMs` |
| `OPENCODE_SEE_DELEGATE_ENABLED` | `visionDelegate.enabled` |
| `OPENCODE_SEE_DELEGATE_PROVIDER_ID` | `visionDelegate.providerID` |
| `OPENCODE_SEE_DELEGATE_MODEL_ID` | `visionDelegate.modelID` |
| `OPENCODE_SEE_DELEGATE_PROMPT` | `visionDelegate.prompt` |
| `OPENCODE_SEE_DELEGATE_TIMEOUT_MS` | `visionDelegate.timeoutMs` |
| `OPENCODE_SEE_DELEGATE_DELETE_AFTER` | `visionDelegate.deleteAfter` |

## Vision delegation for text-only models

The delegate is enabled by default. OpenCode's `chat.params` model capability is
cached per active session. Native vision models keep the original attachment
path with no delegated request. A text-only model causes the plugin to create a
temporary session titled `opencode-see delegate`, prompt the configured vision
model with the same data-URL image parts, collect assistant text, and delete the
session when `deleteAfter` is true.

The timeout covers session creation and the model prompt. Cancellation of the
calling tool also cancels the delegated request. Authentication remains owned by
the OpenCode server; `opencode-see` has no provider key or OAuth flow.

## Prompt examples

```text
Inspect ./screenshots/checkout.png. List visible errors before suggesting code changes.
```

```text
Capture http://localhost:5173/settings at 1280×800. Describe the hierarchy and contrast problems.
```

```text
View these four files and compare the composition: a.png, b.jpg, c.webp, d.gif.
```
