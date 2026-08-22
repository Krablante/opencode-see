# Usage

## `image_view`

```json
{
  "paths": ["./diagram.png", "~/Pictures/reference.webp"]
}
```

`paths` accepts one to five values. Each may be absolute, relative to the active
OpenCode directory, or home-relative with `~/`. Supported signatures are PNG,
JPEG, WebP, and GIF. PDF is intentionally unsupported.

To inspect images already present in the current session, omit `paths`:

```json
{
  "question": "What exact error message is visible?"
}
```

This defaults to `source: "latest"`: the newest supported image batch from a
top-level user attachment or a completed tool result. A multi-image batch keeps
its original order. Use `source: "session"` to retrieve up to five newest unique
supported images, with newer batches first:

```json
{
  "source": "session",
  "question": "How did the layout change across these images?"
}
```

`paths` and `source` are mutually exclusive. Session lookup uses only the
calling session's OpenCode message history. It does not search the filesystem,
read another session, fetch remote URLs, or keep an image cache. Only data-URL
user file parts and attachments on completed tool parts are accepted, and their
bytes must have a supported signature.

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
text-only model. Optional `question` is appended to the configured baseline
delegate prompt and asks the vision model for a focused, evidence-based answer.

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
  "height": 900,
  "question": "Which controls fail contrast requirements?"
}
```

Only HTTP and HTTPS URLs are accepted. `output_path` is relative to the
configured screenshot directory and cannot escape it. `.png` is added when
omitted. Width and height are positive integer viewport dimensions; CDP capture
may include page content beyond the viewport.

`question` has the same delegation behavior as in `image_view`. Native vision
models receive the screenshot directly; a text-only caller receives the
delegate's focused answer.

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
    "model": "opencode-go/gpt-5.6-luna",
    "forceFor": [],
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
| `OPENCODE_SEE_DELEGATE_MODEL` | `visionDelegate.model` |
| `OPENCODE_SEE_DELEGATE_PROMPT` | `visionDelegate.prompt` |
| `OPENCODE_SEE_DELEGATE_TIMEOUT_MS` | `visionDelegate.timeoutMs` |
| `OPENCODE_SEE_DELEGATE_DELETE_AFTER` | `visionDelegate.deleteAfter` |

## Vision delegation

The delegate is enabled by default. OpenCode's `chat.params` model capability is
cached per active session. Native vision models keep the original attachment
path with no delegated request unless their exact `provider/model` reference is
listed in `visionDelegate.forceFor`. A text-only or explicitly forced model
causes the plugin to create a temporary session titled `opencode-see delegate`,
prompt the configured vision model with the same data-URL image parts, collect
assistant text, and delete the session when `deleteAfter` is true.

`forceFor` is an exact-match list with no wildcard or provider-wide behavior.
It affects images returned by `image_view` and `screenshot`; direct user-message
attachments remain part of OpenCode's ordinary active-model transport.

To route Sol image-tool results through the default Luna delegate:

```json
{
  "visionDelegate": {
    "forceFor": ["openai/gpt-5.6-sol"]
  }
}
```

Text-only models also receive one short system instruction telling them to call
`image_view` immediately when an image attachment is present, use the latest
session image when no path is known, and pass the exact visual question. Models
that declare native image input do not receive this instruction.

The model uses OpenCode's ordinary `provider/model` notation. Keep
`opencode-go/gpt-5.6-luna` to spend OpenCode Go credits, or set
`openai/gpt-5.6-luna` to use the ChatGPT OAuth session already authenticated in
OpenCode. These are examples only: there is no provider or model allowlist.
Any exact reference from `opencode models` (or `opencodez models`) is accepted,
including custom providers registered in OpenCode configuration or by another
plugin. Model IDs may contain additional `/` characters; the first segment is
always the provider ID and the rest is passed through as the model ID.

The selected provider must already be authenticated and the selected model must
support image input. No credential is copied into `opencode-see`, and the plugin
does not test or replace the user's selection ahead of time. Provider, auth, or
capability errors are returned as explicit delegation failures. The older
`providerID` and `modelID` config fields and their
`OPENCODE_SEE_DELEGATE_PROVIDER_ID` and `OPENCODE_SEE_DELEGATE_MODEL_ID`
overrides remain accepted for compatibility, but new configurations should use
`model`.

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
