#!/usr/bin/env bash
# Installs the cc-accounts Herdr mod and puts its CLI on the PATH. Idempotent: safe to run again at any time.
#   ./install.sh            link, mod and key
#   ./install.sh --layout   the same, then add the toggle button and the panel to the shown layout
#   ./install.sh --remove   only take the button and the panel out of the shown layout again
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
SRC="$REPO/mods/cc-accounts"
MOD="$APP/mods/cc-accounts"
# The link points into the installed folder, the file the mod runs, so both always answer alike.
CLI="$MOD/cc-accounts"
LINK="$HOME/.local/bin/cc-accounts"
LEGACY="$REPO/bin/cc-accounts"
KEYS="$APP/keys.json"
KEY="ctrl-shift-a"
ACTION="mod.open:cc-accounts"
TITLE="Claude Code accounts"

PLACE=0
REMOVE=0
for arg in "$@"; do
  case "$arg" in
    --layout) PLACE=1 ;;
    --remove) REMOVE=1 ;;
    *) printf 'usage: install.sh [--layout | --remove]\n' >&2; exit 2 ;;
  esac
done
[ "$PLACE$REMOVE" != "11" ] || { printf 'usage: install.sh [--layout | --remove]\n' >&2; exit 2; }

fail() { printf 'install aborted: %s\n' "$1" >&2; exit 1; }

command -v node >/dev/null || fail "node is not on PATH"
if [ "$REMOVE" = 1 ]; then
  node "$REPO/scripts/place-layout.mjs" remove --app "$APP" || fail "the layout was not changed"
  exit 0
fi
[ -d "$APP/mods" ] || fail "$APP/mods not found; open Herdr.app at least once"
[ -f "$KEYS" ] || fail "$KEYS not found; without it the key cannot be merged with yours"
if [ -e "$LINK" ] && [ ! -L "$LINK" ]; then
  fail "$LINK exists and is not a link; remove or rename it first"
fi
ours() {
  case "$1" in
    "$CLI" | "$LEGACY" | */herdr-cc-accounts/bin/cc-accounts | "$HOME/.local/share/cc-accounts/cc-accounts") return 0 ;;
    *) return 1 ;;
  esac
}
if [ -L "$LINK" ] && ! ours "$(readlink "$LINK")"; then
  fail "$LINK is a link that points to another place ($(readlink "$LINK")); remove it first"
fi

# Only a folder this installer made may be overwritten: a real directory whose mod.json has our title.
if [ -e "$MOD" ] || [ -L "$MOD" ]; then
  if [ -L "$MOD" ] || ! node -e '
    const [file, title] = process.argv.slice(1);
    process.exit(JSON.parse(require("fs").readFileSync(file, "utf8")).title === title ? 0 : 1);
  ' "$MOD/mod.json" "$TITLE" 2>/dev/null; then
    fail "$MOD exists and is not this mod; move it away or remove it first"
  fi
fi

bind() { node "$REPO/scripts/bind-key.mjs" "$1" "$KEYS" "$KEY" "$ACTION"; }

# Check the key before touching anything else.
bind check >/dev/null || fail "the key $KEY is not free in $KEYS"

mkdir -p "$MOD/icons"
cp "$SRC/main.js" "$SRC/model.js" "$SRC/cli.js" "$SRC/cc-accounts" "$SRC/mod.json" "$MOD/"
cp "$SRC/icons/"*.svg "$MOD/icons/"
rm -f "$MOD/accounts.svg"
chmod +x "$CLI"
printf 'mod copied to %s\n' "$MOD"

mkdir -p "$HOME/.local/bin"
ln -sfn "$CLI" "$LINK"
printf 'link: %s -> %s\n' "$LINK" "$CLI"

result="$(bind write)" || fail "could not bind $KEY in $KEYS (see the message above)"
printf 'key %s: %s\n' "$KEY" "$result"
if [ "$PLACE" = 1 ]; then
  node "$REPO/scripts/place-layout.mjs" apply --app "$APP" || fail "the mod is installed but the layout was not changed; see the README for the JSON to paste by hand"
fi
printf 'done. Check it with: herdr-app check %s\n' "$MOD"
