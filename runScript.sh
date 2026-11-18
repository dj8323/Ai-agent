#!/usr/bin/env bash
# Starts TelemuneSmartAi: two apps.
#   backend/   Spring Boot (Java 21+) — every /api route, MySQL, OpenAI. Port BACKEND_PORT (8324), this machine only.
#   frontend/  Node (22+, no dependencies) — the pages, forwards /api/* to the backend. Port server.port in config.json (8323).
# Builds the backend when its code changed, restarts older copies of either app, and opens the browser.
#
#   ./runScript.sh            start and open the browser
#   NO_OPEN=1 ./runScript.sh  start without opening a browser
#   Ctrl+C                    stops both
set -euo pipefail

cd "$(dirname "$0")"
HERE="$(pwd -P)"

say()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }

# 1. Tools
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get it from https://nodejs.org (version 22 or newer)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node.js $(node -v) is too old. Please install version 22 or newer."
command -v java >/dev/null 2>&1 || fail "Java is not installed. Install a JDK 21 or newer (e.g. brew install openjdk@21)."
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "${JAVA_MAJOR:-0}" -ge 21 ] || fail "Java ${JAVA_MAJOR:-?} is too old. Please install JDK 21 or newer."

# 2. Secrets (.env: OPENAI_API_KEY, MYSQL_*)
if [ ! -f .env ]; then
  cp .env.example .env
  warn "Created .env from .env.example. Open .env, paste your OPENAI_API_KEY and MySQL password, then run this script again."
  exit 1
fi
grep -Eq '^OPENAI_API_KEY=.+' .env || warn "OPENAI_API_KEY is empty in .env. The page will load, but the agent can't reply until you add it."
grep -Eq '^MYSQL_USER=.+' .env || warn "MYSQL_* settings are missing in .env (see .env.example). Everything is stored in MySQL (database ai-agent)."

BACKEND_PORT="$(sed -n 's/^BACKEND_PORT=//p' .env | tail -1)"
BACKEND_PORT="${BACKEND_PORT:-8324}"
PORT="${PORT:-$(node -p 'try { require("./config.json").server.port } catch { 8323 }')}"
URL="http://localhost:${PORT}"
JAR="backend/target/smartai-backend.jar"
export BACKEND_PORT PORT

# 3. Build the backend when it's missing or its code / SQL changed
if [ ! -f "$JAR" ] || [ -n "$(find backend/src backend/pom.xml db -newer "$JAR" -type f 2>/dev/null | head -1)" ]; then
  command -v mvn >/dev/null 2>&1 || fail "Maven is needed to build the backend (brew install maven)."
  say "Building the backend (Spring Boot)…"
  (cd backend && mvn -q -DskipTests package) || fail "Backend build failed (see the errors above)."
fi

# 4. Free the ports: restart older copies of this app, refuse to touch anything else
free_port() { # port, what-it-should-be (pattern in the command line)
  local port="$1" pattern="$2" pid cmd
  for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    local cwd; cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    if [[ "$cmd" == *$pattern* ]] && [[ "$cwd" == "$HERE"* ]]; then
      say "Stopping the TelemuneSmartAi copy already on port $port (pid $pid)…"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    else
      warn "Port $port is used by another program: ${cmd:-unknown}"
      fail "Stop it, or change the port (server.port in config.json / BACKEND_PORT in .env)."
    fi
  done
}
free_port "$BACKEND_PORT" "smartai-backend.jar"
free_port "$PORT" "server.js"

# 5. Backend in the background (log: logs/backend.log), stopped again when this script ends
mkdir -p logs
say "Starting the backend on port ${BACKEND_PORT}…"
java -jar "$JAR" >> logs/backend.log 2>&1 &
BACK_PID=$!
cleanup() { kill "$BACK_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM
for i in $(seq 1 120); do
  curl -fs "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1 && break
  if ! kill -0 "$BACK_PID" 2>/dev/null; then
    tail -25 logs/backend.log
    fail "The backend stopped while starting (see logs/backend.log). Is MySQL running and are MYSQL_* in .env right?"
  fi
  [ "$i" -eq 120 ] && fail "The backend didn't start within 60 seconds (see logs/backend.log)."
  sleep 0.5
done

# 6. Open the browser once the frontend answers (Chrome preferred: it supports speech recognition)
if [ -z "${NO_OPEN:-}" ]; then
  (
    for _ in $(seq 1 40); do
      if curl -fs "$URL/api/auth-options" >/dev/null 2>&1; then
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

say "TelemuneSmartAi is running at $URL  (backend log: logs/backend.log · Ctrl+C stops both)"
cd frontend
node server.js
