#!/usr/bin/env bash
# Starts TelemuneSmartAi: checks Node, installs dependencies when needed, checks the API key,
# starts the server on the port from config.json, and opens it in the browser.
#
#   ./runScript.sh            start and open the browser
#   NO_OPEN=1 ./runScript.sh  start without opening a browser
set -euo pipefail

cd "$(dirname "$0")"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }

# 1. Node.js 22+ (needed for --env-file-if-exists)
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get it from https://nodejs.org (version 22 or newer)."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || fail "Node.js $(node -v) is too old. Please install version 22 or newer."

# 2. Dependencies (install when missing or when package.json changed)
if [ ! -d node_modules ] || [ package.json -nt node_modules ]; then
  say "Installing dependencies…"
  npm install --no-audit --no-fund
  touch node_modules
fi

# 3. API key
if [ ! -f .env ]; then
  cp .env.example .env
  warn "Created .env from .env.example. Open .env and paste your OPENAI_API_KEY, then run this script again."
  exit 1
fi
if ! grep -Eq '^OPENAI_API_KEY=.+' .env; then
  warn "OPENAI_API_KEY is empty in .env. The page will load, but the agent can't reply until you add it."
fi

# 4. Port from config.json
PORT="${PORT:-$(node -p 'try { require("./config.json").server.port } catch { 8323 }')}"
URL="http://localhost:${PORT}"
HERE="$(pwd -P)"
PIDS="$(lsof -ti tcp:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$PIDS" ]; then
  for PID in $PIDS; do
    PCWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    PCMD="$(ps -o command= -p "$PID" 2>/dev/null || true)"
    if [ "$PCWD" = "$HERE" ] && [[ "$PCMD" == *server.js* ]]; then
      # An older copy of this app is running: restart it so the new code is used.
      say "Restarting the TelemuneSmartAi server that was already running (pid $PID)…"
      kill "$PID" 2>/dev/null || true
      for _ in $(seq 1 20); do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
    else
      warn "Port $PORT is used by another program: ${PCMD:-unknown}"
      fail "Stop it or change server.port in config.json."
    fi
  done
fi

# 5. Open the browser once the server answers (Chrome preferred: it supports speech recognition)
if [ -z "${NO_OPEN:-}" ]; then
  (
    for _ in $(seq 1 40); do
      if curl -fs "$URL/api/config" >/dev/null 2>&1; then
        if [ "$(uname)" = "Darwin" ]; then
          open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
        elif command -v xdg-open >/dev/null 2>&1; then
          xdg-open "$URL" >/dev/null 2>&1
        fi
        exit 0
      fi
      sleep 0.5
    done
  ) &
fi

say "Starting TelemuneSmartAi at $URL  (Ctrl+C to stop)"
exec node --env-file-if-exists=.env server.js
