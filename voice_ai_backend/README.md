# voice_ai_backend — TelemuneSmartAi API

The server side of TelemuneSmartAi: accounts and sign-in, agents, agent types and templates, calls, summaries,
recordings, calendar, caller messages, admin, and every OpenAI call (chat, speech, transcription).
It is a REST + SSE API under `/api`. The web app (`voice_ai_web`) serves the pages and forwards `/api/*` here.

## Requirements

| What | Version | Why |
|---|---|---|
| Java (JDK) | 21 or newer | runs the app (`java -version`) |
| Maven | 3.9+ | builds it (`mvn -v`); dependencies come from `pom.xml` |
| MySQL | 8.x | all data; the database `ai-agent` and its tables are created on first start |
| OpenAI API key | — | chat, text-to-speech, speech-to-text |
| curl, lsof | any | used by `run.sh` (start check, restarting an older copy) |

Libraries (in `pom.xml`, downloaded by Maven): Spring Boot 3.5.6 (`starter-web`, `starter-jdbc`), `mysql-connector-j`,
BouncyCastle `bcprov` (scrypt passwords). No JPA.

## Set up and run

```bash
cp .env.example .env      # then fill in OPENAI_API_KEY and the MySQL login
./run.sh                  # builds when the code changed, starts on port 8324 (Ctrl+C stops it)
./run.sh --build          # only build target/smartai-backend.jar
```

Check it: `curl http://127.0.0.1:8324/api/health` → `{"ok":true}`.
On every start it creates missing tables (`db/schema.sql`), adds missing columns, adds the ready-made agent types and
templates (`db/seed.sql`, kept if an admin edited them), copies `config.json` into `app_config` the first time, and
creates **admin / admin@123** when there are no users (change it at once).

Run it from this folder (or set `APP_HOME`): it reads `.env`, `config.json` and `data/` from here.

## Configuration

**`.env`** (secrets and server settings; never commit it; template: `.env.example`)

| Key | Default | Meaning |
|---|---|---|
| `OPENAI_API_KEY` | — | OpenAI key (required) |
| `MYSQL_HOST` / `MYSQL_PORT` / `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | localhost / 3306 / root / — / ai-agent | MySQL login. Connections use UTC |
| `BACKEND_PORT` | 8324 | API port |
| `BACKEND_HOST` | 127.0.0.1 | Listen address. `127.0.0.1` = only voice_ai_web on this machine; `0.0.0.0` when voice_ai_web runs on another server (then allow only that server in the firewall) |
| `TRUSTED_PROXIES` | — | Addresses of voice_ai_web servers on other machines, comma separated, so the caller's real IP (X-Forwarded-For) is used in logs and the sign-in lockout |
| `LOG_LEVEL` / `SQL_LOG` | DEBUG / DEBUG | `INFO` for less detail / no SQL lines |
| `LOG_DIR` | logs | Log folder |
| `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT` | — | Override the models set in the admin dashboard |
| `APP_HOME` | `.` | Folder holding `config.json` and `data/` |

**`keys.env`** (optional, never commit; template `keys.env.example`): keys for the planned providers and channels:
ElevenLabs (STT + TTS), AWS Transcribe + Polly, Cartesia (TTS), WhatsApp Cloud API, SMTP email, Flash SMS gateway.
Spring property names (`aws.access-key`, `elevenlabs.api-key`, `cartesia.api-key`, `spring.mail.*`, `whatsapp.*`,
`sms.*`), read after `.env`; an empty key leaves that provider off.

**`config.json`** seeds the app settings (`app_config` table) on the **first** start only: branding, agent defaults,
models, speech-to-text, conversation timing, history, calendar, emergency, auth. After that, change them in the admin
dashboard (App settings) or with `PUT /api/admin/config/<section>`. Bottom layer: `src/main/resources/defaults.json`.

## SuperAdmin (role 0)

Roles: **0 SuperAdmin** · 1 admin · 2 user. The SuperAdmin is created on the server only, never from the browser:

1. In `voice_ai_backend/.env` add two lines (any username; the password needs at least 6 characters):
   ```
   SUPERADMIN_USERNAME=superadmin
   SUPERADMIN_PASSWORD=<a temporary password>
   ```
   If that username already exists (for example `admin`), it is **promoted** to SuperAdmin and its password stays the same.
2. Restart the backend (`./run.sh`, or `./runScript.sh` from the project folder). `logs/backend.log` says
   `SuperAdmin: created SuperAdmin superadmin` (or `promoted …`).
3. Sign in at `/login.html` with that username and password. You're asked to set your own password; do it.
4. **Delete the `SUPERADMIN_PASSWORD` line from `.env`** (the username line can stay; it does nothing once the account exists).

Alternative with SQL (an existing account): `UPDATE users SET role_id = 0, permissions = NULL WHERE username = 'admin';`

What only the SuperAdmin can do (admin dashboard → **🛡 Admins** and **🗄 Server**, plus **🔄 Restart backend** in the header and in the
main page's user menu):

- create admins, edit or delete them, and choose per admin the **dashboard sections** they can open and the **app features** they
  (and, at most, their users) get;
- see every admin with the users they created (`users.created_by`);
- edit `.env` and `keys.env` (secrets are never sent to the browser: they show as •••• and change only when a new value is typed;
  each save keeps the old file in `config-backups/`, gitignored) and every `app_config` section as JSON;
- restart the backend: `POST /api/super/restart` starts `./run.sh` in the background, which stops this copy and starts a new one
  (output in `logs/restart.log`). The web app keeps running.

Admins create users (not admins) and choose which app features each user sees, never more than they have themselves. Enforced on
the server: dashboard sections (`ApiFilter`), creating/deleting agents, WhatsApp sending; the rest is hidden in the page.

## Logs

| File | Contents |
|---|---|
| `logs/backend.log` | Everything: every request (`← METHOD path status in N ms`), sign-ins, user actions, OpenAI calls with timings and tokens; at DEBUG also the caller's words, the agent's replies and every SQL statement |
| `logs/error.log` | Warnings and errors only, plus anything the JVM prints itself. Look here first |

Each line: `time(UTC) level [request id] [user] [agent id] class - message`. The request id is also the
`X-Request-Id` response header and is stored in `api_logs` / `activity_logs`, so one id finds a request everywhere.
Files rotate daily into `logs/archive/`. Full guide with all tables and ready SQL queries: **[Troubleshooting.md](Troubleshooting.md)**.

## Data

- MySQL database `ai-agent`: 16 tables (users, sessions, agents, templates, calls, messages, logs…), see Troubleshooting.md.
- Call recordings only on disk: `data/users/<userId>/recordings/<file>`. Back this folder up; never wipe it.

## API

SuperAdmin only: `GET/PUT /api/super/server-config` (.env / keys.env, secrets masked) · `POST /api/super/restart`.

All routes are under `/api`, JSON in and out (errors are `{"error": "…"}`). Signed-in requests carry the HttpOnly cookie
`tsa_session`; non-GET requests whose `Origin` host differs from `Host` are refused. The web app sends `X-Agent-Id`
(the agent in use) on every request.

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login`, `/api/logout` | sign in {username, password, remember} / out |
| POST | `/api/signup` | self sign-up {name, username, email?, password, confirm, remember} |
| GET | `/api/auth-options`, `/api/health` | public: {allowSignup, appName, tagline} / {ok} |
| GET / POST | `/api/me`, `/api/me/password` | who is signed in / change own password {current, next} |
| GET / POST / PATCH / DELETE | `/api/agents[/:id]` | list / create / update / delete agents |
| GET | `/api/templates` | active agent types with their templates |
| GET | `/api/config` | models, voices, languages, emotions, settings of the current agent |
| POST | `/api/settings` | auto-save the current agent |
| POST | `/api/greeting` | the agent's first line (+ cached speech) |
| POST | `/api/chat` | SSE stream: `delta` {text}, `usage`, `error`, `done` |
| POST / GET | `/api/tts`, `/api/tts/stream` | speech (mp3) / streamed speech |
| POST | `/api/transcribe`, `/api/summary` | speech-to-text {text, provider} (optional provider) / call summary {summary, usage} |
| GET | `/api/voices?provider&lang` | voices of a TTS provider: openai, aws (Polly), elevenlabs, cartesia |
| POST | `/api/whatsapp/send` | {to, message}: send a typed WhatsApp message through the approved summary template (`whatsapp.text-*` in keys.env; `whatsapp.text-mode=text` = free text via `/sendTextWhatsApp`, delivered only within 24 hours of the person's last message); also saved in `calls` with channel `whatsapp` |
| POST | `/api/emergency/alert` | {label, keyword}: WhatsApp / email alert to that emergency contact |
| GET | `/api/models` | OpenAI models {chat, stt, tts} (only admins pick models; `POST /api/settings` ignores them for users) |
| GET/POST/DELETE | `/api/playbooks[/:id]` | the user's own playbooks |
| GET/POST/DELETE | `/api/calendar[/:id]`, `/api/calendar/calendar.ics` | meetings the agent booked |
| GET/POST/PATCH/DELETE | `/api/messages[/:id]` | messages callers left |
| GET/POST/DELETE, PUT | `/api/calls[/:id]`, `/api/calls/stats`, `/:id/summary`, `/:id/recording` | call history and recordings (`?channel=call\|chat\|voice\|whatsapp`; stats has `byChannel`) |
| GET | `/api/admin/overview`, `/api/admin/logs`, `/api/admin/logins` | admin: totals, activity, sign-ins |
| POST/GET/PATCH/DELETE | `/api/admin/users[/:id]` | admin: users |
| GET / PUT | `/api/admin/config[/:section]`, `/api/admin/log-level` | admin: app settings, live log level |
| GET, POST/PUT/DELETE | `/api/admin/templates`, `/api/admin/types[/:key]`, `/api/admin/templates[/:id]` | admin: agent types and templates |

## Speech providers and messages

| | Providers | Code |
|---|---|---|
| Speech-to-text | OpenAI, ElevenLabs Scribe, Amazon Transcribe (streaming WebSocket, 16 kHz PCM) | `ai/SpeechService`, `ai/AwsTranscribe`, `ai/Aws` (SigV4, no SDK) |
| Text-to-speech | OpenAI, Amazon Polly (neural), ElevenLabs, Cartesia Sonic | `ai/SpeechService` |
| Call summaries | Email (Spring Mail), WhatsApp (Telemune gateway); Flash SMS later | `service/NotifyService` |
| Emergency alerts | WhatsApp, email (phone contacts are only shown to the caller) | `service/NotifyService` |

Each agent picks its providers (agents.tts_provider / stt_provider). A provider without keys is shown as "not set up";
if a provider fails during a call, speech and transcription fall back to OpenAI so the call keeps going (WARN in the log).
Messages are sent in the background after the call is saved. WhatsApp uses the Telemune gateway:
`POST /sendWhatsApp {"to": "91…", "template": "ai_message_summary", "headerParam": "Conversation Summary", "params": [name, summary], "reply": "Thanks"}`
(tested 2026-11-19; emergency alerts use the same call with `emergency_alert_new`, header "Emergency Alert", params [agent, alert]). The header and the values each template takes are settings in `keys.env` (`whatsapp.summary-header`,
`whatsapp.summary-params`, `whatsapp.emergency-*`). The summary goes as one line of up to ~700 characters.

## Voices

The voice list is `Prompts.VOICES` (id → label). End each label with `(male)` or `(female)`: the web app reads it to show
a male or female cartoon agent on the call page (anything not marked male gets the female one). Adding or removing a
voice needs no change in voice_ai_web.

## Folder

```
run.sh                 build + start            .env.example   settings template      config.json   first-start settings
pom.xml                Maven build (Java 21, Spring Boot 3.5.6)
db/schema.sql          all tables (IF NOT EXISTS)   db/seed.sql   ready-made agent types + templates
src/main/resources/    application.properties, defaults.json, logback-spring.xml
src/main/java/com/telemune/smartai/
  Bootstrap.java · SmartAiApplication.java
  db/Db.java           schema + migrations + seed on start; SQL helpers (every statement logged)
  web/                 ApiFilter (sign-in, origin check, request ids, api_logs), Ctx, ApiException, ErrorAdvice
  ai/                  OpenAiClient (chat, speech, transcription), Prompts (system prompt + reply tags)
  service/             Auth, Agent, Template, Playbook, Call, Calendar, Message, AppConfig, Log
  api/                 Auth, Agent, Config, Voice, Data, Admin controllers
Troubleshooting.md     logs, tracing a request, every table, ready SQL queries
data/  logs/  target/  (not in git)
```
