# Security policy

## Supported versions

Security fixes are made on the latest release line.

## Report a vulnerability

Do not open a public issue for an unpatched vulnerability. Use GitHub's private
security advisory flow for this repository and include:

- the affected version;
- a minimal reproduction;
- the filesystem or browser boundary involved;
- the impact you observed.

## Trust boundary

OpenCode plugins run with the same operating-system identity as OpenCode.
Install only code you trust. `opencode-see` asks OpenCode for `read` permission
for each image and `external_directory` permission outside the worktree. It has
no provider credential loader and performs no direct provider API calls.

When vision delegation is enabled for a text-only active model, the plugin sends
the image to the configured vision model through a temporary OpenCode session.
The OpenCode server owns provider authentication and transport; the plugin never
reads those credentials. Treat the delegate configuration as a data-routing
choice and use only a provider you trust with the selected images.

When `image_view` uses `latest` or `session`, the plugin reads projected messages
only for the calling OpenCode session ID. It accepts supported data-URL images
from top-level user file parts and completed tool attachments, validates their
byte signatures, and keeps no cache. It does not enumerate other sessions,
search the filesystem, or fetch remote attachment URLs. Because those bytes are
already held by the current OpenCode session, this path requests no additional
filesystem permission.

The `screenshot` tool starts a local browser process and allows only HTTP and
HTTPS URLs. A page can still target services reachable from the local machine;
review URLs before approving tool use in untrusted sessions.
