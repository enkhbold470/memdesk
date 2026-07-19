#!/usr/bin/env bash
# Install memdesk as an always-on launchd agent that runs at login.
set -euo pipefail

LABEL="com.memdesk.agent"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUN="$(command -v bun || true)"
AGENTS="$HOME/Library/LaunchAgents"
PLIST="$AGENTS/$LABEL.plist"

if [[ -z "$BUN" ]]; then
  echo "✗ bun not found on PATH. Install bun first: https://bun.sh" >&2
  exit 1
fi

mkdir -p "$AGENTS" "$DIR/logs"

sed -e "s#__BUN__#$BUN#g" -e "s#__DIR__#$DIR#g" \
  "$DIR/daemon/$LABEL.plist" > "$PLIST"

# Reload if already present.
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load -w "$PLIST"

echo "✓ Installed and started $LABEL"
echo "  plist:  $PLIST"
echo "  logs:   $DIR/logs/agent.{out,err}.log"
echo
echo "Grant Screen Recording permission to 'bun' the first time it runs:"
echo "  System Settings → Privacy & Security → Screen Recording"
echo
echo "Uninstall with: bun run uninstall-daemon"
