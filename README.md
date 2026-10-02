<h1 align="center">opencode-see</h1>

<p align="center"><strong>Let your OpenCode agent look at the image.</strong><br>
Local files, chat attachments, and web screenshots — delivered to the active vision model<br>
or described by a vision delegate using OpenCode's existing authentication.</p>

<p align="center">
  <a href="./README.md"><strong>English</strong></a> · <a href="./README.ru.md">Русский</a>
</p>

<p align="center">
  <a href="https://github.com/Krablante/opencode-see/releases">Releases</a> ·
  <a href="./docs/usage.md">Usage</a> ·
  <a href="./docs/configuration.md">Configuration</a> ·
  <a href="./docs/operations.md">Operations</a> ·
  <a href="./docs/architecture.md">Architecture</a>
</p>

<p align="center">
  <img alt="Local image to OpenCode attachment to vision model" src="./assets/stickers-en.svg" width="720">
</p>

## What it does

`opencode-see` adds two tools to OpenCode and OpenCodez. `image_view` opens PNG,
JPEG, WebP, and GIF files or retrieves images already attached to the current
chat. `screenshot` captures an HTTP or HTTPS page with local Chromium.

A model that accepts images receives ordinary OpenCode file attachments. A
text-only model receives an answer from your configured vision delegate. The
delegate reads the pixels and answers the caller's visual question; it has no
tools of its own. OpenCode handles provider credentials and model requests.

Use it to read an error from a screenshot, compare a running interface with a
design reference, or inspect a diagram without setting up an upload service.
The same plugin runs in upstream OpenCode and compatible forks without a core
patch.

## See the flow

<p align="center">
  <img alt="Illustrated tool calls showing actual local-image metadata and a Chromium capture" src="./assets/demo-en.gif" width="900">
</p>

This is an illustrated walkthrough generated from the real image reader and
Chromium capture functions. The tool calls are rendered examples, not shell
commands or a recording of a model response. See [Contributing](./CONTRIBUTING.md)
for reproduction requirements.

## Install

You need Node.js 22 or newer and OpenCode or OpenCodez. Chromium is optional;
only `screenshot` needs it. Distribution is through **this GitHub repository**.
The npm package named `opencode-see` belongs to an unrelated project.

```bash
git clone https://github.com/Krablante/opencode-see.git \
  ~/.local/share/opencode/plugins/opencode-see
cd ~/.local/share/opencode/plugins/opencode-see
npm ci --omit=dev
```

Add the source to the `plugin` array in `~/.config/opencode/opencode.jsonc`,
using your actual absolute path:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///home/you/.local/share/opencode/plugins/opencode-see/src/index.ts"
  ]
}
```

Restart OpenCode. For OpenCodez, edit `~/.config/opencodez/opencode.jsonc`
instead. Both use the same plugin entry point. On Windows, use a stable clone
directory and an absolute URL such as `file:///C:/Users/you/plugins/opencode-see/src/index.ts`.

## Use it

Ask the agent directly:

```text
Use image_view to inspect ./design/home.webp. What is wrong with the layout?
Read the exact error message from the image I just attached.
Capture http://localhost:3000 at 1440×900 and compare it with ~/Pictures/reference.png.
```

| Tool | Input | Result |
| --- | --- | --- |
| `image_view` | `paths`, or `source: "latest"` / `"session"`; optional `question` | Up to five images, with metadata and native attachments or a delegated answer |
| `screenshot` | `url`; optional `output_path`, `width`, `height`, `question` | Saved PNG, capture metadata, and native vision or a delegated answer |

Local files require OpenCode's read permission. Screenshots go to
`<active project>/.opencode/screenshots` by default. Each image is limited to
20 MiB. PDF is unsupported.

Native vision needs no plugin configuration. To use a text-only model, select
an authenticated image-capable model from `opencode models` in
`~/.config/opencode/opencode-see.json` (OpenCodez uses its own config directory):

```json
{
  "visionDelegate": {
    "model": "your-provider/your-vision-model"
  }
}
```

Delegation is enabled by default and consumes the selected provider's credits.
The shipped default is `opencode-go/gpt-5.6-luna`; choose a model available to
your account. [Configuration](./docs/configuration.md) explains forced routes,
timeouts, and environment overrides.

## Go deeper

- [Usage](./docs/usage.md): tool arguments, session images, and examples.
- [Configuration](./docs/configuration.md): settings and model routing.
- [Operations](./docs/operations.md): updates, browser setup, and troubleshooting.
- [Architecture](./docs/architecture.md): ownership, data flow, and resource costs.
- [Contributing](./CONTRIBUTING.md) · [Security](./SECURITY.md) · [Changelog](./CHANGELOG.md).

Licensed under [MIT](./LICENSE). Third-party attribution is in [NOTICE](./NOTICE).
