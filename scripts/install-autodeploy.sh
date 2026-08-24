#!/usr/bin/env bash
#
# Installs a launchd agent that polls origin/main and deploys any new commits.
#
# Polling rather than a webhook: the app is reachable only through the
# Cloudflare Tunnel behind a password, so there is no public endpoint GitHub
# could call without punching a hole in that. A one-minute poll is a few
# seconds slower and adds no attack surface.
#
# Run from the repository root:  ./scripts/install-autodeploy.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/atriveo-reel"
AGENTS_DIR="$HOME/Library/LaunchAgents"
LABEL="com.atriveo.reel.autodeploy"

INTERVAL="${AUTODEPLOY_INTERVAL_SECONDS:-60}"

if [[ ! -x "$REPO_DIR/scripts/deploy.sh" ]]; then
  chmod +x "$REPO_DIR/scripts/deploy.sh"
fi

mkdir -p "$LOG_DIR" "$AGENTS_DIR"

cat > "$AGENTS_DIR/$LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$REPO_DIR/scripts/deploy.sh</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_DIR</string>

    <key>StartInterval</key>
    <integer>$INTERVAL</integer>

    <!-- Not at load: a deploy on every login would restart the services for
         no reason. The first poll runs $INTERVAL seconds from now. -->
    <key>RunAtLoad</key>
    <false/>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/autodeploy.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/autodeploy.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>

    <!-- Background priority: a deploy must never compete with a render. -->
    <key>ProcessType</key>
    <string>Background</string>
    <key>Nice</key>
    <integer>5</integer>
</dict>
</plist>
PLIST

launchctl unload "$AGENTS_DIR/$LABEL.plist" 2>/dev/null || true
launchctl load "$AGENTS_DIR/$LABEL.plist"

echo "Auto-deploy installed."
echo "  polls origin/main every ${INTERVAL}s"
echo "  log: $LOG_DIR/autodeploy.log"
echo
echo "Push to main from anywhere and it deploys within ${INTERVAL}s."
echo "Remove with:  launchctl unload $AGENTS_DIR/$LABEL.plist && rm $AGENTS_DIR/$LABEL.plist"
