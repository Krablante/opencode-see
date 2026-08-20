# Architecture

The plugin is an adapter between the local filesystem and OpenCode's existing
attachment contract.

```text
path ── resolve + authorize ──> bytes ──> data:image/...;base64,...
                                               │
                                               ▼
                                  OpenCode file attachment
                                               │
                                               ▼
                                  active provider transport
                                               │
                                               ▼
                                     vision model input
```

## Why there is no provider code

The active OpenCode session already owns provider authentication, capability
selection, request conversion, retries, and model choice. Reimplementing any of
that in this plugin would make it provider-specific and create a second secret
boundary. `opencode-see` therefore has no `auth` plugin hook and never calls a
model API.

The only network activity initiated by this repository is:

- Chromium loading the URL explicitly passed to `screenshot`;
- local loopback HTTP and WebSocket traffic used to control that Chromium
  process through the Chrome DevTools Protocol.

## Image path boundary

Paths are expanded and canonicalized with `realpath` before permission is
requested. This matters for symlinks: a link inside the worktree cannot hide an
external target. The tool asks `external_directory` for canonical paths outside
the worktree, then asks `read` for every image.

MIME detection uses file signatures. Dimensions are parsed directly from PNG,
JPEG, WebP, and GIF headers; no decoding library is loaded. The bytes are then
encoded once as a data URL.

## Screenshot boundary

CDP is the primary backend. It starts one short-lived headless browser, obtains
the debugging port from its temporary profile, navigates one page, captures a
PNG as base64, writes the configured output, and removes the profile.

Ordinary browser installations may use a headless CLI fallback. Snap Chromium
does not: its private `/tmp` makes CLI file handoff unreliable, while CDP returns
the bytes over loopback independently of snap filesystem visibility.

There is no OpenCode/OpenCodez core patch. Both applications load the same
public plugin interface.
