# voice_ai_web — TelemuneSmartAi web app

The part people see and use: sign-in, the call page with the 🎙 call button, My agents, Tutorials, and the admin
dashboard. Plain HTML/CSS/JavaScript, **no framework, no npm dependencies, no build step**.
A small Node server (`server.js`) serves the pages and forwards every `/api/*` request to **voice_ai_backend**, so the
browser sees one address: the sign-in cookie and the live reply stream (SSE) work without CORS.

## Requirements

| What | Version | Why |
|---|---|---|
| Node.js | 22 or newer | runs `server.js` (`node -v`). Nothing to `npm install` |
| openssl | any | makes the HTTPS certificate (`scripts/make-cert.sh`) |
| curl, lsof | any | used by `run.sh` |
| voice_ai_backend | running | every `/api/*` call goes there (`backendUrl`) |
| Browser | Chrome or Edge | live captions use the Web Speech API; the mic needs https or localhost |

## Run

```bash
./run.sh                  # starts on http://localhost:8323 and https://<this machine's IP>:8443, opens Chrome
NO_OPEN=1 ./run.sh        # without opening the browser
npm run check             # syntax check of the JavaScript
```

Start voice_ai_backend first. If it isn't reachable, the pages say so until it is.

## Configuration

**`config.json`**

| Key | Default | Meaning |
|---|---|---|
| `port` | 8323 | http port (use `http://localhost:8323` on this machine) |
| `httpsPort` | 8443 | https port for other computers |
| `backendUrl` | `http://127.0.0.1:8324` | where voice_ai_backend runs |

**`.env`** (optional, overrides config.json; template `.env.example`; no secrets): `PORT`, `HTTPS_PORT`, `BACKEND_URL`,
`HTTPS=off`, `HTTPS_CERT`, `HTTPS_KEY`, `LOG_DIR`.

App settings (branding, models, timings…) are not here: they live in the backend (admin dashboard → App settings).

## HTTPS (microphone from other computers)

Browsers allow the microphone only on `https://` or on `localhost`. `run.sh` makes a self-signed certificate once
(`certs/server.crt` + `.key`, covering localhost, this computer's name and its IP addresses; remade when the IP changes)
and serves the same app on `https://<IP>:8443`. `http://<IP>:8323` is redirected there; localhost stays on http.
Over https the sign-in cookie is marked `Secure`.

First visit from another computer: "Your connection is not private" → **Advanced → Proceed**. To remove the warning,
copy `certs/server.crt` to that computer and trust it:

| Computer | How |
|---|---|
| Windows | Double-click → Install Certificate → Local Machine → **Trusted Root Certification Authorities** → restart the browser |
| Mac | Double-click (Keychain Access, System) → open it → Trust → **Always Trust** |
| Android | Settings → Security → Encryption & credentials → Install a certificate → CA certificate |
| iPhone / iPad | Install the profile, then Settings → General → About → Certificate Trust Settings → on |

`./scripts/make-cert.sh --force` makes a new certificate. For production with a domain name, put a trusted certificate in
front instead (Caddy or nginx with Let's Encrypt, proxying to port 8323), or point `HTTPS_CERT` / `HTTPS_KEY` at it.

## Logs

| File | Contents |
|---|---|
| `logs/web.log` | One line per request: http/https, method, path, status, time, caller IP and the backend's request id `[…]` |
| `logs/error.log` | Problems only: backend unreachable, 5xx answers, server errors |

The request id in `[…]` is the same id as in `voice_ai_backend/logs/backend.log`, so you can follow one click from the
browser to the database. Query strings are not logged (they can contain spoken text).

## How it talks to the backend

- Every `/api/*` request is streamed to `backendUrl` with `X-Forwarded-For` (caller IP) and `X-Forwarded-Proto`.
- Page guard: signed-out visits to `/`, `/index.html`, `/admin.html` → `/login.html` (asks the backend `/api/me`);
  `/admin.html` is admins only.
- The pages send `X-Agent-Id` (the agent in use) on every `/api/` request.
- The API itself is documented in `voice_ai_backend/README.md`.
- When the backend runs on another server: set `backendUrl` here, `BACKEND_HOST=0.0.0.0` and `TRUSTED_PROXIES=<this
  server's IP>` in the backend's `.env`.

## Folder

```
run.sh              start                 config.json   ports + backendUrl     .env.example   optional overrides
server.js           static pages + /api proxy + page guard + https + logs
package.json        name, Node 22+, scripts (no dependencies)
scripts/make-cert.sh   self-signed HTTPS certificate → certs/
public/
  login.html        sign in + create account
  index.html        call page + My agents + dialogs (layout + CSS, light/dark theme tokens)
  app.js            routing, agent setup, call flow, speech in/out, live caller bubble, tours
  agent-face.js     "Ava", the cartoon agent on the call card: talks with the voice, listens, thinks, 20 emotions
  admin.html, admin.js   admin dashboard
  motion.css, motion.js  shared motion theme (network background, glass cards, pill menu, chat animations)
  telemune-mark.png, telemune-logo.svg   logo / favicon
certs/  logs/  (not in git)
```
