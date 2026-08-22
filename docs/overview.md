# Overview

`opencode-see` gives an active OpenCode model access to an image that already
exists on the host or in the current session, directly for vision models or
through a configured vision delegate for text-only and explicitly selected
models. It solves two adjacent jobs:

- `image_view` reads an existing PNG, JPEG, WebP, or GIF from a local path or
  the current session;
- `screenshot` captures an HTTP/HTTPS page to PNG, then returns that PNG.

There are three deliberately separate levels:

1. **Image source.** The plugin resolves and authorizes a local path, or reads
   data-URL file parts from the calling session, then identifies the image from
   its byte signature.
2. **Routing input.** The plugin represents validated bytes as
   `{ type: "file", mime, url }` with a base64 data URL and useful text metadata.
3. **Model delivery.** The plugin either returns that standard attachment to the
   active provider transport or sends it through a temporary OpenCode session on
   the configured vision delegate and returns the resulting text.

The plugin owns level one and the routing decision at the standard attachment
boundary. It never owns provider credentials or calls a provider API directly;
delegation uses the existing OpenCode SDK client and server authentication. If a
compatible host hides an active tool attachment behind completed remote
compaction, the plugin can restore the same stored attachment for the immediate
continuation without interpreting or caching it.

## Intended use

- inspect screenshots, diagrams, paintings, photos, and UI references;
- inspect a user attachment immediately even when the active model is text-only;
- compare a localhost page with a local design image;
- let an agent reason about visual output without a separate upload service;
- use the same plugin with upstream OpenCode and compatible forks.

## Deliberate exclusions

There is no OCR pipeline, image hosting, PDF support, model API client,
credential store, retrieval index, watcher, or daemon.
