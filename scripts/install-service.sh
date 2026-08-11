#!/usr/bin/env bash
#
# Installs Atriveo Reel as three launchd services: the web app, the render
# worker, and the Cloudflare Tunnel that publishes the app. All start at login
# and restart on crash.
#
# The tunnel is a service rather than a terminal command because the app is
# only reachable through it: if it stops, the public URL goes dead even though
# the app is still running locally.
#
# Run from the repository root:  ./scripts/install-service.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOME/Library/Logs/atriveo-reel"
AGENTS_DIR="$HOME/Library/LaunchAgents"

WEB_LABEL="com.atriveo.reel.web"
WORKER_LABEL="com.atriveo.reel.worker"
TUNNEL_LABEL="com.atriveo.reel.tunnel"

TUNNEL_CONFIG="$REPO_DIR/scripts/cloudflared-reels.yml"

# launchd gives services a minimal PATH, so Homebrew tools would not be found.
# Resolve the real prefix rather than assuming /opt/homebrew.
if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="$(brew --prefix)"
else
  BREW_PREFIX="/opt/homebrew"
  echo "warning: brew not found; assuming $BREW_PREFIX" >&2
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "error: node not found on PATH" >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

SERVICE_PATH="$NODE_DIR:$BREW_PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if [[ ! -d "$REPO_DIR/.next" ]]; then
  echo "error: no production build found. Run 'npm run build' first." >&2
  exit 1
fi

if [[ ! -f "$REPO_DIR/.env" ]]; then
  echo "error: no .env file. Copy .env.example to .env and configure it." >&2
  exit 1
fi

# An empty APP_PASSWORD disables auth entirely (see src/middleware.ts). That is
# fine locally, but these services publish the app through the tunnel, so an
# unset password would put an open app on the public internet.
if ! grep -qE '^APP_PASSWORD=.+' "$REPO_DIR/.env"; then
  echo "error: APP_PASSWORD is empty in .env — refusing to publish an app with" >&2
  echo "       no password. Set one, then re-run this script." >&2
  exit 1
fi

CLOUDFLARED_BIN="$(command -v cloudflared || true)"
if [[ -z "$CLOUDFLARED_BIN" ]]; then
  echo "error: cloudflared not found on PATH. Install it with 'brew install cloudflared'." >&2
  exit 1
fi

if [[ ! -f "$TUNNEL_CONFIG" ]]; then
  echo "error: no tunnel config at $TUNNEL_CONFIG" >&2
  exit 1
fi

mkdir -p "$LOG_DIR" "$AGENTS_DIR"

write_plist() {
  local label="$1" script="$2" logname="$3"

  cat > "$AGENTS_DIR/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$label</string>

    <key>ProgramArguments</key>
    <array>
        <string>$NODE_DIR/npm</string>
        <string>run</string>
        <string>$script</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$SERVICE_PATH</string>
        <key>NODE_ENV</key>
        <string>production</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <!-- Don't respawn faster than this if it crashes on startup. -->
    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/$logname.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/$logname.log</string>

    <!-- Rendering is CPU-heavy; keep it from starving the UI. -->
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
PLIST
}

# The tunnel runs a binary directly rather than an npm script, so it needs its
# own plist rather than the npm-shaped one above.
write_tunnel_plist() {
  cat > "$AGENTS_DIR/$TUNNEL_LABEL.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>$TUNNEL_LABEL</string>

    <key>ProgramArguments</key>
    <array>
        <string>$CLOUDFLARED_BIN</string>
        <string>tunnel</string>
        <!-- launchd captures output; cloudflared's own autoupdate would
             restart the process out from under it. -->
        <string>--no-autoupdate</string>
        <string>--config</string>
        <string>$TUNNEL_CONFIG</string>
        <string>run</string>
    </array>

    <key>WorkingDirectory</key>
    <string>$REPO_DIR</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>$SERVICE_PATH</string>
        <key>HOME</key>
        <string>$HOME</string>
    </dict>

    <key>RunAtLoad</key>
    <true/>

    <!-- Unconditional: the tunnel exits cleanly when its origin goes away, and
         that is exactly when it must come back. SuccessfulExit=false would
         leave the public URL dead after an app restart. -->
    <key>KeepAlive</key>
    <true/>

    <key>ThrottleInterval</key>
    <integer>10</integer>

    <key>StandardOutPath</key>
    <string>$LOG_DIR/tunnel.log</string>
    <key>StandardErrorPath</key>
    <string>$LOG_DIR/tunnel.log</string>
</dict>
</plist>
PLIST
}

echo "Installing services from $REPO_DIR"
echo "  node:        $NODE_DIR"
echo "  brew:        $BREW_PREFIX"
echo "  cloudflared: $CLOUDFLARED_BIN"
echo "  logs:        $LOG_DIR"

write_plist "$WEB_LABEL" "start" "web"
write_plist "$WORKER_LABEL" "worker" "worker"
write_tunnel_plist

for label in "$WEB_LABEL" "$WORKER_LABEL" "$TUNNEL_LABEL"; do
  # Unload first so re-running this script picks up changes.
  launchctl unload "$AGENTS_DIR/$label.plist" 2>/dev/null || true
  launchctl load "$AGENTS_DIR/$label.plist"
  echo "  loaded $label"
done

echo
echo "Started. Check status with:"
echo "  launchctl list | grep atriveo.reel"
echo "  tail -f $LOG_DIR/web.log"
echo "  tail -f $LOG_DIR/worker.log"
echo "  tail -f $LOG_DIR/tunnel.log"
