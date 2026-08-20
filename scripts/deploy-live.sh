#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT=${OPENCODE_SEE_SOURCE_ROOT:-$(dirname "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")")}
LIVE_DIR=${OPENCODE_SEE_LIVE_DIR:-$HOME/.local/share/opencode/plugins/opencode-see}

if [[ ! -f "$SOURCE_ROOT/package.json" || ! -f "$SOURCE_ROOT/src/index.ts" ]]; then
  printf 'opencode-see source tree is incomplete: %s\n' "$SOURCE_ROOT" >&2
  exit 1
fi

parent=$(dirname "$LIVE_DIR")
mkdir -p "$parent"
temporary=$(mktemp -d "$parent/.opencode-see.XXXXXX")
cleanup() { rm -rf "$temporary"; }
trap cleanup EXIT

tar -C "$SOURCE_ROOT" \
  --exclude=.git \
  --exclude=.github \
  --exclude=node_modules \
  --exclude=.opencode \
  -cf - . | tar -C "$temporary" -xf -

rm -rf "$LIVE_DIR"
mv "$temporary" "$LIVE_DIR"
trap - EXIT

printf 'staged opencode-see at %s\n' "$LIVE_DIR"
printf 'add this absolute URL to the OpenCode plugin array, then restart OpenCode:\n'
printf 'file://%s/src/index.ts\n' "$LIVE_DIR"
