#!/usr/bin/env bash
# KS EMR installer for macOS and Linux.
#
# One line (installs into ~/ks-emr on port 4700):
#   curl -fsSL https://raw.githubusercontent.com/mustard-jedi/ks-emr/main/deploy/install.sh | bash
#
# Choose the folder and the port:
#   curl -fsSL https://raw.githubusercontent.com/mustard-jedi/ks-emr/main/deploy/install.sh | bash -s -- --dir ~/web-apps/ks-emr --port 4800
#
# Options:
#   --dir <folder>    where to install            (default: ~/ks-emr)
#   --port <number>   port to listen on           (default: 4700)
#   --url <address>   address people will type    (default: http://localhost:<port>)
#   --label <text>    title-bar label for an install that does NOT hold real records
#   --name <name>     PM2 process name            (default: ks-emr)
#   --branch <name>   git branch to install       (default: main)
#
# It downloads the code, writes the settings file (.env), then runs deploy/deploy.sh, which builds
# the app and starts it under PM2. It never overwrites an existing .env or touches existing data.
# Running it again on the same folder simply updates that install.
set -euo pipefail

REPO="${KS_REPO:-https://github.com/mustard-jedi/ks-emr.git}"
DIR="$HOME/ks-emr"
PORT=4700
URL=""
LABEL=""
NAME=""
BRANCH="main"

say() { printf '\n==> %s\n' "$*"; }
fail() { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="${2:?--dir needs a folder}"; shift 2 ;;
    --port) PORT="${2:?--port needs a number}"; shift 2 ;;
    --url) URL="${2:?--url needs an address}"; shift 2 ;;
    --label) LABEL="${2:?--label needs some text}"; shift 2 ;;
    --name) NAME="${2:?--name needs a name}"; shift 2 ;;
    --branch) BRANCH="${2:?--branch needs a name}"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0" 2>/dev/null || true; exit 0 ;;
    *) fail "Unknown option: $1 (see the top of deploy/install.sh for the options)" ;;
  esac
done

case "$PORT" in ''|*[!0-9]*) fail "--port must be a number, for example 4800." ;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || fail "--port must be between 1024 and 65535."
case "$DIR" in "~/"*) DIR="$HOME/${DIR#\~/}" ;; esac

# ---- what must already be on the machine ----
if [ "$(uname -s)" = "Darwin" ]; then HINT="Install it with Homebrew (https://brew.sh):  brew install node git"
else HINT="Install it with your package manager, or from https://nodejs.org"; fi
command -v git >/dev/null || fail "git is required. $HINT"
command -v node >/dev/null || fail "Node.js 20 or newer is required. $HINT"
command -v npm >/dev/null || fail "npm is required (it comes with Node.js). $HINT"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js 20 or newer is required; found $(node -v). $HINT"

# ---- the code ----
if [ -d "$DIR/.git" ]; then
  say "Using the existing install in $DIR"
elif [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
  fail "$DIR already exists and is not a KS EMR install. Choose another folder with --dir."
else
  say "Downloading KS EMR into $DIR"
  mkdir -p "$(dirname "$DIR")"
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"
[ -f deploy/deploy.sh ] && [ -f ecosystem.config.cjs ] || fail "$DIR does not look like a KS EMR checkout."

# ---- the settings file ----
detect_tz() {
  if [ -n "${TZ:-}" ]; then printf '%s' "$TZ"
  elif [ -L /etc/localtime ]; then readlink /etc/localtime | sed 's|.*/zoneinfo/||'
  elif [ -f /etc/timezone ]; then tr -d '[:space:]' < /etc/timezone
  else printf 'UTC'; fi
}

if [ -f .env ]; then
  say "Keeping the existing settings in $DIR/.env"
else
  say "Writing settings to $DIR/.env"
  {
    echo "# KS EMR settings for this install. Written by deploy/install.sh; edit freely, then run ./deploy/deploy.sh."
    echo "# All options are explained in .env.example."
    echo "PORT=$PORT"
    echo "HOST=127.0.0.1"
    echo "KS_DATA_DIR=./data"
    echo "KS_PUBLIC_URL=${URL:-http://localhost:$PORT}"
    echo "NODE_ENV=production"
    echo "TZ=$(detect_tz)"
    [ -n "$LABEL" ] && echo "KS_ENV_LABEL=$LABEL"
    [ -n "$NAME" ] && echo "KS_PM2_NAME=$NAME"
    true
  } > .env
  chmod 600 .env
fi

# ---- build and start ----
KS_BRANCH="$BRANCH" exec bash deploy/deploy.sh
