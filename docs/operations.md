# Operations

## Runtime characteristics

`image_view` has no background process. A local-path call reads each file once;
a session-source call reads the calling session through the OpenCode SDK. Both
produce at most five validated data-URL images. `latest` normally limits history
to 64 messages and expands to the full current history only when that window is
full but has no image. Explicit `session` lookup scans current history for the
five newest unique images. OpenCode owns downstream resizing and transport.

For a text-only active model, or a native model named in
`visionDelegate.forceFor`, one temporary OpenCode session is created and prompted
on the configured vision delegate. The request is bounded to 90 seconds by
default and the session is deleted afterward. Other native vision models perform
no extra model request.

`screenshot` runs one short-lived browser attempt at a time. A CLI fallback starts
only after the CDP browser is stopped. There is no persistent browser, queue,
cache, worker, or service. The default
timeout is 30 seconds and the default late-content budget is 2 seconds.
The timeout is shared across CDP and CLI fallback, including target discovery
and navigation. Cancellation and timeout skip fallback. Browser shutdown and
profile removal complete before the call returns, so elapsed time can exceed
the capture budget by a short cleanup delay. Both backends use private temporary
profiles and refuse to replace an existing output file.

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

### Repeated plugin-load error mentioning `paths.filter`

Upgrade to 0.4.1 or newer and restart OpenCode. Older versions exported a
permission helper from the plugin entry point; OpenCode could register the tools
and then mistakenly call that helper as another plugin initializer. This was a
plugin export defect, not a model or provider failure.

### A screenshot times out or is cancelled

The capture budget includes both backends, not a fresh timeout per attempt.
Cancellation does not retry. A short delay while the browser exits is expected.
For a genuinely slow page, increase `screenshotTimeoutMs`; increasing the
late-content budget alone does not increase the overall deadline.

### The model did not see an image

Check the active model capability and `visionDelegate.forceFor` in OpenCode. An
unlisted vision model should receive an attachment. A text-only or forced model
should receive a `Vision via <modelID>:` block; verify that
`visionDelegate.enabled` is true and the configured provider/model is
authenticated and supports image input. Delegation failures are returned as text
and never replaced with a guessed description.

If the image was attached in chat, call `image_view` without `paths` or with
`source: "latest"`. A text-only model is instructed to do this automatically.
Use `source: "session"` only when comparison across recent image batches is
intentional. Session lookup accepts data URLs already stored by OpenCode; it does
not fetch remote attachment URLs.

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
npm run typecheck
```

For a manual capture check, open a small local HTTP page and inspect the saved
PNG. Also try an unreachable URL, a page that never finishes loading, cancellation
before and during capture, and an existing output path. Check that cancellation
does not start fallback, failed calls leave no browser/profile behind, and logs
contain no delayed unhandled CDP rejection. Exercise an ordinary Chromium CLI
fallback as well as Snap CDP when those installations are available.

For live acceptance, use `image_view` with a text-only model, a forced native
model, and an unlisted native model. The first two should receive a focused
`Vision via` answer without an attachment; the unlisted model should receive the
original attachment without a delegate call. Also verify an explicit local path,
`source: "session"`, and `screenshot` with `question` when those paths change.
