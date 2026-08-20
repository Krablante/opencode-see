# Operations

## Runtime characteristics

`image_view` has no background process. It reads each file once and creates one
base64 data URL. A call accepts at most five images. OpenCode owns downstream
image resizing and provider transport.

`screenshot` starts one browser process per call and closes it after capture.
There is no persistent browser, queue, cache, worker, or service. The default
timeout is 30 seconds and the default late-content budget is 2 seconds.

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

Confirm the tool result contains an attachment and that the active model
declares image input support in OpenCode. This plugin cannot add vision to a
text-only model. Check whether another transport layer removed unsupported
parts.

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

For a live acceptance test, load the plugin in OpenCode, call `image_view` on a
known local image, then ask a vision-capable model to describe a distinctive
visual fact. Repeat with `screenshot` against a localhost page.
