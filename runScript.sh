#!/usr/bin/env bash
# Starts both TelemuneSmartAi apps on this machine (a shortcut for development):
#   voice_ai_backend/run.sh   the API (Spring Boot, port 8324)      — started in the background
#   voice_ai_web/run.sh       the web app (Node, ports 8323 / 8443)  — started in the foreground
# Each app can also be started on its own from its folder. Ctrl+C stops both.
#
#   ./runScript.sh            start both and open the browser
#   NO_OPEN=1 ./runScript.sh  start both without opening a browser
set -euo pipefail
cd "$(dirname "$0")"

./voice_ai_backend/run.sh &
BACK=$!
trap 'kill "$BACK" 2>/dev/null || true; wait "$BACK" 2>/dev/null || true' EXIT INT TERM

PORT="$(sed -n 's/^BACKEND_PORT=//p' voice_ai_backend/.env 2>/dev/null | tail -1)"
for i in $(seq 1 240); do
  curl -fs "http://127.0.0.1:${PORT:-8324}/api/health" >/dev/null 2>&1 && break
  kill -0 "$BACK" 2>/dev/null || { echo "voice_ai_backend didn't start (see voice_ai_backend/logs/error.log)."; exit 1; }
  sleep 0.5
done

./voice_ai_web/run.sh
