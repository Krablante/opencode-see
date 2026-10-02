# Operations

[English](./operations.md) · [Русский](./operations.ru.md) · [Home](../README.md)

## Install and update

[README](../README.md#install) owns installation instructions. The plugin runs
from TypeScript source through the host's loader. It needs no build, container,
daemon, or release pipeline. `package-lock.json` pins the dependency tree;
`npm ci --omit=dev` installs only runtime dependencies. The package is private
to prevent npm publication; the code remains public and MIT-licensed.

Update a clean clone with:

```bash
git pull --ff-only
npm ci --omit=dev
```

Restart OpenCode or OpenCodez afterward. An already loaded plugin keeps the old
code. For a pinned installation, choose a published Git tag instead of tracking
`main`; consult [Releases](https://github.com/Krablante/opencode-see/releases)
and [Changelog](../CHANGELOG.md) before upgrading. To roll back, check out the
previous chosen revision, run the same install command, and restart again.

Operator-managed installations should use their existing deployment mechanism
to copy `src/`, `package.json`, and `package-lock.json`, install dependencies,
and restart the intended host. Verify the copied source matches the selected
revision. Never replace a directory containing user configuration or captures
as an update shortcut.

## Browser setup

Only `screenshot` needs a Chromium-based browser. Discovery tries an explicit
`chromiumPath` / `OPENCODE_SEE_CHROMIUM` first and fails if that choice is broken.
Without an override it checks `chromium-browser`, `google-chrome`, Linux snap
launchers, and `chromium`, then standard Chrome locations on macOS and Windows
and Edge under Windows Program Files.

| System | Installation |
| --- | --- |
| Debian | `sudo apt install chromium` |
| Ubuntu | `sudo snap install chromium` or the distribution's `chromium-browser` package |
| Fedora | `sudo dnf install chromium` |
| macOS | Install Google Chrome |
| Windows | Use Microsoft Edge or install Google Chrome |

Set `OPENCODE_SEE_CHROMIUM` if your executable lives elsewhere. Run OpenCode as
a normal user; this plugin does not disable Chromium's sandbox for root or
container execution. Browser startup errors surface from the capture attempt.

## Storage and deadlines

Screenshots remain in the configured output directory until you remove them.
Keep runtime captures out of source control and apply your own retention policy.
The plugin owns no cleanup daemon. Browser profiles are temporary and removed
after each capture; Snap profiles use snap-visible user storage.

Native image delivery adds no model request. Delegation adds one model session
and provider charge. It deletes the session by default; `deleteAfter: false`
retains images and text in host storage. Session history and native attachments
also remain subject to OpenCode's normal storage policy.

The capture deadline is 30 seconds by default, shared across CDP and CLI. Snap
does not use CLI fallback. Timeout and caller cancellation stop capture without
retrying. Browser shutdown finishes before return and can add a short delay.
The delegate's 90-second deadline covers creation and the answer; server abort
and deletion have separate cleanup budgets of up to 10 seconds each.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Model did not see the image | Native image capability, exact `forceFor` route, and the `Vision via` or failure block |
| Delegate fails | Exact model ID, provider authentication, and image input support; do not assume the default Go model is available |
| Chat image not found | Call `image_view` without paths; only current-session supported data URLs qualify |
| Unexpected permission prompt | Canonical path in metadata: the symlink target may be outside the worktree |
| Browser not found | Browser installation or the explicit executable override |
| Snap CDP fails | Snap user storage and permission to use loopback debugging; CLI fallback is deliberately unavailable |
| Late page content missing | Increase `virtualTimeBudgetMs`; also increase the capture timeout if total load time needs it |
| Capture times out | One deadline covers both attempts; slow or unreachable navigation can consume it before fallback |
| Output already exists | Choose a fresh name; the plugin refuses overwrites |
| Plugin load reports `paths.filter` | Upgrade to 0.4.1 or later and restart; older exports confused the plugin loader |

Configuration errors include the relevant field or path. See
[Configuration](./configuration.md) for precedence and all overrides.

## Verification

For development, install all dependencies with `npm ci`, then run `npm run check`.
The existing suite covers routing, extraction, permissions, configuration, and
capture lifecycle. CI runs the same command on Node.js 22.

After a runtime update, load the plugin in a fresh host session. Check a local
image and a chat attachment with native vision, then a text-only or forced model
with a specific question. For browser changes, capture a small local page,
inspect the saved PNG, and verify cancellation leaves no browser or temporary
profile. Do not infer live acceptance from unit tests alone.
