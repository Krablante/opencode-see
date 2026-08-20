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
  process through the Chrome DevTools Protocol;
- one bounded local OpenCode session-history read when a completed remote
  mid-turn compaction has hidden an active image tool result.

## Remote compaction boundary

Some compatible hosts can replace an active turn with opaque server-side state
between a tool result and the model continuation. `opencode-see` handles only
the exact completed boundary represented by an automatic `mid-turn` compaction
part with an OpenAI remote payload and an original turn ID.

The message hook checks only the final two projected messages. On a match, it
reads at most 32 recent session messages, finds the last assistant step from the
original turn, and restores up to five completed `image_view` or `screenshot`
attachments in a synthetic user message. That message exists only in the model
projection. It is not written to session history or shown in the UI.

There is no separate provider, model, auth, or config lookup, and no cache,
background task, or persistent replay state. Ordinary OpenCode, local
compaction, legacy transports, other providers, uncompacted turns, and completed
continuations return before the session read. Provider retries rebuild the same
projection until one normal assistant continuation completes.

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
