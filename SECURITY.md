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
no provider credential loader and performs no model API calls.

The `screenshot` tool starts a local browser process and allows only HTTP and
HTTPS URLs. A page can still target services reachable from the local machine;
review URLs before approving tool use in untrusted sessions.
