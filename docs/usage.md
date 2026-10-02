# Usage

[English](./usage.md) · [Русский](./usage.ru.md) · [Home](../README.md)

## Open local images

`image_view` accepts one to five unique paths. Paths resolve from the active
OpenCode directory; absolute paths and `~/` are also accepted. The tool resolves
symlinks, asks for read permission, and asks for `external_directory` permission
when a target lies outside the worktree.

```json
{
  "paths": ["./diagram.png", "~/Pictures/reference.webp"],
  "question": "What changed between these two layouts?"
}
```

PNG, JPEG, WebP, and GIF are supported. Each file must be at most 20 MiB. The
plugin identifies format and dimensions from bytes, not the filename. It reads
image headers, not a full pixel decoder; a damaged image can still fail in the
host or provider. PDF and remote image URLs are unsupported.

## Reuse chat images

Omit `paths` to inspect the newest image batch in the calling session:

```json
{ "question": "What exact error message is visible?" }
```

This is equivalent to `source: "latest"`. A batch comes from a user message's
file parts or one completed tool result. It retains its original order and
returns at most five unique supported images. Use `source: "session"` to
compare up to five recent unique images across batches, newest batches first:

```json
{ "source": "session", "question": "How did the layout change?" }
```

`paths` and `source` are mutually exclusive. Session lookup accepts only stored
data URLs from the current session. It ignores malformed, oversized, or
unsupported images and never fetches remote attachment URLs. Those bytes need
no new filesystem permission.

## Capture a page

`screenshot` opens a page in a fresh local Chromium profile. It does not reuse
your login cookies or an existing browser tab.

```json
{
  "url": "http://localhost:3000",
  "output_path": "home.png",
  "width": 1440,
  "height": 900,
  "question": "Which labels are hard to read?"
}
```

Only HTTP and HTTPS are accepted. The default viewport is 1440×900. Width and
height must be positive integers with a total of at most 32 megapixels
(33,554,432 pixels). Capture covers the viewport. `output_path` stays inside the
configured screenshot directory, including through symlinks; `.png` is added
when omitted. Existing files are never replaced. Omitting the name generates
a timestamped filename. The resulting PNG must also fit the 20 MiB image limit.

## Read the result

Native vision models receive images and text metadata. Other callers receive
metadata followed by `Vision via <modelID>:` and the delegate's answer. Optional
`question` adds a focused question to the delegate's baseline prompt; native
attachments are unaffected. A failed delegate returns an explicit failure,
never a guessed description. [Configuration](./configuration.md) controls routing.

Metadata includes filename or path, byte count, format, and dimensions.
`core_resize=yes` is a hint based on known host thresholds: over 2000 pixels on
either side or over 5 MiB of base64. The plugin does not resize images; actual
resizing depends on the OpenCode version and provider.

On compatible hosts, remote OpenAI mid-turn compaction can hide a fresh image
tool result. The plugin restores that batch for the immediate continuation.
This replay needs no configuration and appears only in the model's input.
See [Architecture](./architecture.md) for its narrow boundary.
