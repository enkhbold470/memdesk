#!/usr/bin/env bash
# Stop and remove the memdesk launchd agent.
set -euo pipefail

LABEL="com.memdesk.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm -f "$PLIST"
  echo "✓ Removed $LABEL"
else
  echo "• $LABEL is not installed (no plist at $PLIST)"
fi
