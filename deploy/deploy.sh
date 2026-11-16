#!/usr/bin/env bash
# KS EMR deploy / update script for macOS and Linux.
#
# First install:   use deploy/install.sh (it writes .env and then runs this script)
# Every update:    ./deploy/deploy.sh
#
# What it does: back up -> pull from GitHub -> install dependencies -> build -> drop build-only packages
#               -> restart under PM2 -> check the service answers.
set -euo pipefail

cd "$(dirname "$0")/.."
APP_DIR="$(pwd)"
BRANCH="${KS_BRANCH:-main}"
say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null || fail "Node.js 20 or newer is required (https://nodejs.org)."
command -v git >/dev/null || fail "git is required."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 or newer is required; found $(node -v)."
if ! command -v pm2 >/dev/null; then
  say "Installing PM2"
  npm install -g pm2 || fail "Could not install PM2. Run: sudo npm install -g pm2"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  fail "Created .env from .env.example. Edit it (at least PORT, KS_PUBLIC_URL and TZ), then run this script again."
fi

# Read one setting from .env (last one wins; surrounding quotes removed).
setting() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//' || true; }
PORT="$(setting PORT)"; PORT="${PORT:-4700}"
PM2_NAME="$(setting KS_PM2_NAME)"; PM2_NAME="${PM2_NAME:-ks-emr}"

# Refuse to start on a port that something else is already using (for example another KS EMR install).
if ! pm2 describe "$PM2_NAME" >/dev/null 2>&1 && curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then
  fail "Port $PORT is already in use by another program. Change PORT in $APP_DIR/.env and run this script again."
fi

# A plain-text backup before anything changes, if there is something to back up.
if [ -f dist/server/cli.js ] && [ -n "$(find . -maxdepth 2 -name 'ks-emr.db' -print -quit)" ]; then
  say "Backing up the database"
  node dist/server/cli.js backup || fail "Backup failed; not updating."
fi

say "Pulling the latest code ($BRANCH)"
git fetch --prune origin
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

say "Installing dependencies"
npm ci --include=dev

say "Building"
npm run build

say "Removing build-only packages"
npm prune --omit=dev

say "Restarting the service"
pm2 startOrReload ecosystem.config.cjs --env production --update-env
pm2 save

say "Checking http://127.0.0.1:$PORT/api/status"
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -fsS "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
    say "KS EMR $(node -p "require('./package.json').version") is running in $APP_DIR"
    echo "    Open it on this machine:      http://localhost:$PORT"
    echo "    To start it at boot (once):   pm2 startup   (then run the command it prints)"
    echo "    To update later:              $APP_DIR/deploy/deploy.sh"
    exit 0
  fi
  sleep 1
done
fail "The service did not answer. Look at: pm2 logs $PM2_NAME"
