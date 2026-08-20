# Operations

## Runtime characteristics

`image_view` has no background process. It reads each file once and creates one
base64 data URL. A call accepts at most five images. OpenCode owns downstream
image resizing and provider transport.

For a text-only active model, one temporary OpenCode session is created and
prompted on the configured vision delegate. The request is bounded to 90 seconds
by default and the session is deleted afterward. Native vision models perform no
extra model request.

`screenshot` starts one browser process per call and closes it after capture.
There is no persistent browser, queue, cache, worker, or service. The default
timeout is 30 seconds and the default late-content budget is 2 seconds.

The message transform normally returns without I/O. Only a completed compatible
remote mid-turn compaction marker causes one local OpenCode history read, capped
at 32 messages, to restore up to five image attachments for the immediate model
continuation. The replay is projection-only and keeps no cache or persistent
state.

## Paths

- public config: `~/.config/opencode/opencode-see.json` unless the active
  OpenCode config directory overrides it;
- default screenshots: `<active project>/.opencode/screenshots`;
- local plugin install: any stable clone referenced by an absolute `file://`
  URL;
- snap CDP profiles: ephemeral directories under snap user storage, removed
  after each call.

Generated screenshots are runtime artifacts. Keep them out of source control
unless a project deliberately treats one as a fixture or documentation asset.

## Troubleshooting

### The model did not see an image

Check the active model capability in OpenCode. A vision model should receive an
attachment. A text-only model should receive a `Vision via <modelID>:` block;
verify that `visionDelegate.enabled` is true and the configured provider/model
is authenticated and supports image input. Delegation failures are returned as
text and never replaced with a guessed description.

### Permission was requested for an unexpected directory

The plugin authorizes canonical paths after resolving symlinks. Inspect the
resolved path in the metadata: a link may point outside the worktree.

### Chromium was not found

Install Chromium/Chrome or set `OPENCODE_SEE_CHROMIUM` to an executable. The
tool returns an OS-specific hint when discovery finds nothing.

### CDP fails under snap

Make sure the snap can create data under its user directory and no mandatory
security policy blocks loopback debugging. The plugin intentionally does not
fall back to CLI for snap.

### A page captures before late content appears

Increase `virtualTimeBudgetMs`. For a slow page, also increase
`screenshotTimeoutMs`. Keep both bounded; this is a short-lived tool call, not a
browser test runner.

## Verification

```bash
npm install
npm run check
npm run demos:check
```

For live acceptance, call `image_view` on a known local image from both a
text-only and a vision-capable model. The text-only result must contain `Vision
via`, while the native vision result must contain an attachment and create no
delegate session. Repeat with `screenshot` against a localhost page when its
capture path changed.
