#!/usr/bin/env bash
# voice_ai_backend: the TelemuneSmartAi API (Spring Boot, Java 21+, MySQL 8, OpenAI).
#
#   ./run.sh              build if the code changed, then start in the foreground (Ctrl+C stops it)
#   ./run.sh --build      only build target/smartai-backend.jar
#
# Settings: .env (secrets, MySQL, port, log levels; copy .env.example) and config.json (first-start app settings).
# Logs: logs/backend.log (everything) and logs/error.log (problems). Recordings: data/users/<userId>/recordings/.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd -P)"

say()  { printf '\033[1;36m▸ [backend] %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ [backend] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✖ [backend] %s\033[0m\n' "$*"; exit 1; }

# 1. Java 21+
command -v java >/dev/null 2>&1 || fail "Java is not installed. Install a JDK 21 or newer (e.g. brew install openjdk@21)."
JAVA_MAJOR="$(java -version 2>&1 | sed -n 's/.*version "\([0-9]*\).*/\1/p' | head -1)"
[ "${JAVA_MAJOR:-0}" -ge 21 ] || fail "Java ${JAVA_MAJOR:-?} is too old. Please install JDK 21 or newer."

# 2. Build when the jar is missing or the code / SQL changed
JAR="target/smartai-backend.jar"
if [ ! -f "$JAR" ] || [ -n "$(find src pom.xml db -newer "$JAR" -type f 2>/dev/null | head -1)" ]; then
  command -v mvn >/dev/null 2>&1 || fail "Maven is needed to build (brew install maven)."
  say "Building (Maven)…"
  mvn -q -DskipTests package || fail "Build failed (see the errors above)."
fi
[ "${1:-}" = "--build" ] && { say "Built $JAR"; exit 0; }

# 3. Settings
if [ ! -f .env ]; then
  cp .env.example .env
  fail "Created .env from .env.example. Fill in OPENAI_API_KEY and the MySQL login, then run ./run.sh again."
fi
grep -Eq '^OPENAI_API_KEY=.+' .env || warn "OPENAI_API_KEY is empty in .env: the API starts, but agents can't reply until you add it."
grep -Eq '^MYSQL_USER=.+' .env || warn "MYSQL_* settings are missing in .env (see .env.example)."
BACKEND_PORT="${BACKEND_PORT:-$(sed -n 's/^BACKEND_PORT=//p' .env | tail -1)}"
BACKEND_PORT="${BACKEND_PORT:-8324}"

# 4. Port: restart an older copy of this backend, refuse to touch anything else
for pid in $(lsof -ti tcp:"$BACKEND_PORT" -sTCP:LISTEN 2>/dev/null || true); do
  cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
  cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  if [[ "$cmd" == *smartai-backend.jar* ]] && [[ "$cwd" == "$HERE"* ]]; then
    say "Stopping the copy already on port $BACKEND_PORT (pid $pid)…"
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
  else
    fail "Port $BACKEND_PORT is used by another program: ${cmd:-unknown}. Stop it or change BACKEND_PORT in .env."
  fi
done

# 5. Start (the app writes logs/backend.log and logs/error.log itself; anything the JVM prints goes to error.log)
mkdir -p logs data
say "Starting on port ${BACKEND_PORT}…  logs: $HERE/logs/backend.log, logs/error.log"
java -jar "$JAR" > /dev/null 2>> logs/error.log &
PID=$!
trap 'kill "$PID" 2>/dev/null || true' EXIT INT TERM
for i in $(seq 1 120); do
  if curl -fs "http://127.0.0.1:${BACKEND_PORT}/api/health" >/dev/null 2>&1; then
    say "Ready: http://127.0.0.1:${BACKEND_PORT}/api  (Ctrl+C stops it)"
    break
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    tail -25 logs/error.log
    fail "Stopped while starting (see logs/error.log and logs/backend.log). Is MySQL running and are MYSQL_* in .env right?"
  fi
  [ "$i" -eq 120 ] && fail "Didn't start within 60 seconds (see logs/error.log)."
  sleep 0.5
done
wait "$PID"
