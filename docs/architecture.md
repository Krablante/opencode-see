# Architecture

The plugin is an adapter between local or session-owned image bytes and
OpenCode's existing attachment contract.

```text
local path ── resolve + authorize ──┐
                                    ├──> validated bytes ──> data:image/...;base64,...
session history ── current ID only ─┘                         │
                                                              ▼
                                                 OpenCode file attachment
                                               │
                                               ▼
                                   capability decision
                                      │          │
                                 image=true  image=false
                                      │          │
                              active transport  temporary OpenCode session
                                      │          │
                              vision input   delegate text result
```

## Why there is still no provider code

The active OpenCode session already owns provider authentication, capability
selection, request conversion, retries, and model choice. Reimplementing any of
that in this plugin would make it provider-specific and create a second secret
boundary. `opencode-see` therefore has no `auth` plugin hook and never calls a
provider API directly. Vision delegation asks the existing OpenCode SDK client
to run a temporary session; the server applies its normal authentication,
transport, retries, and model configuration.

The only network activity initiated by this repository is:

- Chromium loading the URL explicitly passed to `screenshot`;
- local loopback HTTP and WebSocket traffic used to control that Chromium
  process through the Chrome DevTools Protocol;
- an OpenCode SDK request that creates, prompts, and optionally deletes a
  temporary vision session when the active model is text-only;
- a current-session OpenCode history read when `image_view` uses `latest` or
  `session` as its source;
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

## Vision delegation boundary

The `chat.params` hook records the active model ID and declared image capability
for each session. A tool call first reads that cache and falls back to the live
session plus provider catalog when needed. Native vision returns the original
attachments unchanged. Text-only sessions either run the configured delegate or
receive an explicit unsupported-model message when delegation is disabled.

Delegate requests are bounded by the configured timeout and the calling tool's
abort signal. They use ordinary file parts in a temporary session, return only
assistant text to the text-only caller, and delete that session by default. The
plugin keeps no provider secret and no image-description cache. A per-call
`question` supplements rather than replaces the configured baseline delegate
prompt. Only models that explicitly declare `input.image=false` receive the
system hint that routes otherwise opaque image attachments to `image_view`.

## Session image boundary

`image_view` addresses the calling `ToolContext.sessionID` through
`client.session.messages`; it never enumerates sessions. `latest` first inspects
the newest 64 messages and falls back to the full current history only when that
window is full and contains no supported image. Explicit `session` lookup reads
the current history and returns at most five newest unique images.

The extractor accepts top-level user file parts and `attachments` from completed
tool states. It ignores remote URLs, unsupported labels, incomplete tool states,
and malformed data. Accepted data URLs are decoded and passed through the same
signature and dimension checks as local files, so attachment metadata is not a
trust shortcut. Results are ephemeral; there is no cache, index, database, or
cross-session lookup.

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
