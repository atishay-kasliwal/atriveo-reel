#!/usr/bin/env bash
#
# Removes the Atriveo Reel launchd services. Leaves ~/reels-data untouched.

set -euo pipefail

AGENTS_DIR="$HOME/Library/LaunchAgents"

for label in com.atriveo.reel.web com.atriveo.reel.worker; do
  plist="$AGENTS_DIR/$label.plist"
  if [[ -f "$plist" ]]; then
    launchctl unload "$plist" 2>/dev/null || true
    rm -f "$plist"
    echo "removed $label"
  else
    echo "$label not installed"
  fi
done

echo
echo "Services removed. Your data in DATA_DIR was not touched."
