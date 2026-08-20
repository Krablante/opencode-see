# Overview

`opencode-see` gives a vision-capable model access to an image that already
exists on the OpenCode host. It solves two adjacent jobs:

- `image_view` reads an existing PNG, JPEG, WebP, or GIF;
- `screenshot` captures an HTTP/HTTPS page to PNG, then returns that PNG.

There are three deliberately separate levels:

1. **Local file.** The plugin resolves a path, asks permission, reads bytes, and
   identifies the image from its signature.
2. **OpenCode attachment.** The plugin returns `{ type: "file", mime, url }`
   with a base64 data URL and useful text metadata.
3. **Model input.** OpenCode's active provider transport converts that standard
   attachment into the image-input shape supported by the current model.

The plugin owns only level one and the standard boundary into level two. It
does not select, configure, or call the provider or model that receives the
request. If a compatible host hides an active tool attachment behind completed
remote compaction, the plugin can use that marker's remote provider ID to
restore the same stored attachment for the immediate continuation without
interpreting or caching it.

## Intended use

- inspect screenshots, diagrams, paintings, photos, and UI references;
- compare a localhost page with a local design image;
- let an agent reason about visual output without a separate upload service;
- use the same plugin with upstream OpenCode and compatible forks.

## Deliberate exclusions

There is no OCR pipeline, image hosting, PDF support, model API client,
credential store, retrieval index, watcher, or daemon.
