#!/usr/bin/env bash
#
# Pulls the latest main and deploys it to the running services.
#
# Safe to run unattended: the build and tests must pass before anything is
# restarted, so a broken commit leaves the current site serving rather than
# taking it down. Restarts both the web app and the worker — they are separate
# processes running the same code, and restarting only one leaves the other on
# a stale build, which has broken renders here before.
#
# Run by hand, or on a timer via scripts/install-autodeploy.sh.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

log() { echo "[deploy $(date '+%Y-%m-%d %H:%M:%S')] $*"; }

# launchd hands us a minimal PATH; node, npm, git and ffmpeg all live outside it.
if command -v brew >/dev/null 2>&1; then
  BREW_PREFIX="$(brew --prefix)"
else
  BREW_PREFIX="/opt/homebrew"
fi
NODE_DIR="$(dirname "$(command -v node || echo /usr/local/bin/node)")"
export PATH="$NODE_DIR:$BREW_PREFIX/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# A dirty tree means someone is mid-edit. Deploying would blow away their work
# or ship a half-finished change, so stop instead.
if [[ -n "$(git status --porcelain)" ]]; then
  log "working tree is dirty — skipping deploy"
  exit 0
fi

restart_services() {
  local uid
  uid="$(id -u)"
  for label in com.atriveo.reel.web com.atriveo.reel.worker; do
    launchctl kickstart -k "gui/$uid/$label" 2>/dev/null || true
  done
}

BEFORE="$(git rev-parse HEAD)"

log "fetching origin"
git fetch --quiet origin main

REMOTE="$(git rev-parse origin/main)"
if [[ "$BEFORE" == "$REMOTE" ]]; then
  log "already up to date at ${BEFORE:0:8}"
  exit 0
fi

log "updating ${BEFORE:0:8} -> ${REMOTE:0:8}"
git merge --ff-only origin/main

# Roll back to the previous commit if anything below fails, so a bad push can
# never leave the site broken.
rollback() {
  log "FAILED — rolling back to ${BEFORE:0:8}"
  git reset --hard "$BEFORE" >/dev/null
  npm run build >/dev/null 2>&1 || log "warning: rollback build also failed"
  restart_services
  exit 1
}
trap rollback ERR

log "installing dependencies"
npm ci --silent >/dev/null 2>&1 || npm install --silent >/dev/null 2>&1

log "typecheck"
npm run typecheck >/dev/null

log "tests"
npm test >/dev/null 2>&1

log "build"
npm run build >/dev/null 2>&1

trap - ERR

log "restarting services"
restart_services

# Give the app a moment to bind before checking it answers.
sleep 12
CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 http://127.0.0.1:3001/login || echo 000)"
if [[ "$CODE" != "200" ]]; then
  log "health check failed (HTTP $CODE) — rolling back"
  git reset --hard "$BEFORE" >/dev/null
  npm run build >/dev/null 2>&1 || true
  restart_services
  exit 1
fi

log "deployed ${REMOTE:0:8} — healthy (HTTP $CODE)"
