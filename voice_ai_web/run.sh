#!/usr/bin/env bash
# voice_ai_web: the TelemuneSmartAi web app (Node 22+, no dependencies, no build step).
# Serves the pages in public/ and forwards /api/* to voice_ai_backend (backendUrl in config.json / BACKEND_URL).
#
#   ./run.sh              start in the foreground (Ctrl+C stops it)
#   NO_OPEN=1 ./run.sh    same, without opening the browser
#
# Settings: config.json (port, httpsPort, backendUrl), optional .env (copy .env.example) overrides them.
# HTTPS for other computers: certs/ (made here by scripts/make-cert.sh). Logs: logs/web.log, logs/error.log.
set -euo pipefail
cd "$(dirname "$0")"
HERE="$(pwd -P)"

say()  { printf '\033[1;35m▸ [web] %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ [web] %s\033[0m\n' "$*"; }
fail() { printf '\033[1;31m✖ [web] %s\033[0m\n' "$*"; exit 1; }

# 1. Node 22+
command -v node >/dev/null 2>&1 || fail "Node.js is not installed. Get it from https://nodejs.org (version 22 or newer)."
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 22 ] || fail "Node.js $(node -v) is too old. Please install version 22 or newer."

# 2. Settings: .env (if any) over config.json
envval() { [ -f .env ] && sed -n "s/^$1=//p" .env | tail -1 || true; }
PORT="${PORT:-$(envval PORT)}";                 PORT="${PORT:-$(node -p 'try { require("./config.json").port || 8323 } catch { 8323 }')}"
HTTPS_PORT="${HTTPS_PORT:-$(envval HTTPS_PORT)}"; HTTPS_PORT="${HTTPS_PORT:-$(node -p 'try { require("./config.json").httpsPort || 8443 } catch { 8443 }')}"
BACKEND_URL="${BACKEND_URL:-$(envval BACKEND_URL)}"; BACKEND_URL="${BACKEND_URL:-$(node -p 'try { require("./config.json").backendUrl || "http://127.0.0.1:8324" } catch { "http://127.0.0.1:8324" }')}"
HTTPS="${HTTPS:-$(envval HTTPS)}"
export PORT HTTPS_PORT BACKEND_URL

# 3. Ports: restart an older copy of this web app, refuse to touch anything else
for port in "$PORT" "$HTTPS_PORT"; do
  for pid in $(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    cmd="$(ps -o command= -p "$pid" 2>/dev/null || true)"
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
    if [[ "$cmd" == *server.js* ]] && [[ "$cwd" == "$HERE"* ]]; then
      say "Stopping the copy already on port $port (pid $pid)…"
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 40); do kill -0 "$pid" 2>/dev/null || break; sleep 0.25; done
    else
      fail "Port $port is used by another program: ${cmd:-unknown}. Stop it or change the port in config.json."
    fi
  done
done

# 4. HTTPS certificate for other computers (the browser allows the microphone only on https or localhost).
#    Made once, and again when this machine's IP address changed. HTTPS=off skips it.
LAN_URL=""
if [ "${HTTPS:-on}" != "off" ]; then
  if ./scripts/make-cert.sh >/dev/null 2>&1; then
    LAN_IP="$( (ipconfig getifaddr en0 || ipconfig getifaddr en1 || hostname -I | awk '{print $1}') 2>/dev/null | head -1 || true)"
    LAN_URL="https://${LAN_IP:-your-IP}:${HTTPS_PORT}"
  else
    warn "Couldn't make the HTTPS certificate (is openssl installed?). Other computers can open the page, but not use the microphone."
  fi
fi

# 5. Backend reachable?
curl -fs "${BACKEND_URL}/api/health" >/dev/null 2>&1 || warn "voice_ai_backend doesn't answer at ${BACKEND_URL} yet. Pages will say so until it runs."

URL="http://localhost:${PORT}"
say "Running at $URL  (API → $BACKEND_URL · logs: $HERE/logs/web.log, logs/error.log · Ctrl+C stops it)"
[ -n "$LAN_URL" ] && say "From other computers: $LAN_URL  (first visit: Advanced → Proceed; see README for trusting the certificate)"

# 6. Open the browser once the page answers (Chrome preferred: it supports live captions)
if [ -z "${NO_OPEN:-}" ]; then
  (
    for _ in $(seq 1 40); do
      if curl -fs "$URL/login.html" >/dev/null 2>&1 || curl -s -o /dev/null -w '%{http_code}' "$URL/login.html" 2>/dev/null | grep -q 503; then
        if [ "$(uname)" = "Darwin" ]; then open -a "Google Chrome" "$URL" 2>/dev/null || open "$URL"
        elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1; fi
        exit 0
      fi
      sleep 0.5
    done
  ) &
fi

mkdir -p logs
exec node server.js
