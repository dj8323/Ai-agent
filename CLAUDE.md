# TelemuneSmartAi — project guide

A multilingual **AI voice agent** you talk to from the browser with a call button. The caller speaks, the agent
answers out loud with an emotional voice, and every call gets a summary, stats and an optional recording.
Agents can work **for a person** ("Hello, this is Brown, DJ's assistant. DJ isn't available… I can schedule a meeting
or pass a message on"): they book meetings into the calendar and take messages.
Branding: "TelemuneSmartAi", footer "Powered by Telemune © 2027 · Designed by DJ".

## Two applications (read this first)

| App | Folder | Port | What it does |
|---|---|---|---|
| **Backend** | `backend/` | `BACKEND_PORT` (8324), bound to 127.0.0.1 | Spring Boot 3.5 (Java 21+, Maven). Every `/api` route, MySQL, OpenAI |
| **Frontend** | `frontend/` | `server.port` in `config.json` (8323) | Node 22+, no dependencies. Serves `frontend/public/` and forwards `/api/*` to the backend (same origin, so cookies and SSE just work) |

- The browser only talks to the frontend. Signed-out visits to `/`, `/index.html`, `/admin.html` → `/login.html`
  (the frontend asks the backend `/api/me`); `/admin.html` is admins only; `/api/*` returns 401 when signed out.
- The old single Node server (`server.js`, `auth.js`, …) was replaced on 2026-11-18; it is in git history
  (commit `1bc7bec` and earlier).

## Storage = MySQL

- Everything lives in MySQL, database **`ai-agent`** (connection in `.env`: `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`).
  `db/schema.sql` = all tables (IF NOT EXISTS); `db/seed.sql` = ready-made agent types + templates (INSERT IGNORE, so
  admin edits are kept). Both are copied into the backend jar and run on every backend start (`db/Db.java`), which
  also adds missing columns to old tables (`Db.migrate()`). Connections use UTC: every DATETIME is UTC.
- Tables: `roles` (1 admin, 2 user) · `users` · `sessions` · `login_attempts` (every sign-in, drives the lockout) ·
  `app_config` (shared settings, one JSON per section) · `agent_types` + `agent_templates` (personas, greetings, scripts) ·
  `agents` + `emergency_rules` (each agent's own setup) · `playbooks` · `calls` + `call_summaries` · `calendar_events` ·
  `messages` (messages callers left) · `activity_logs` (who did what) · `api_logs` (every API request).
- Only call recordings stay on disk: `data/users/<userId>/recordings/<file>` (file name in `calls.recording_file`).
- Backups of the pre-MySQL JSON data: `backups/pre-mysql-2026-11-17/`, `backups/pre-login-2026-11-17/`.

## Accounts & roles

- `/login.html` → POST `/api/login` → HttpOnly `tsa_session` cookie (`app_config.auth.sessionHours`, or `rememberDays`
  with "Keep me signed in"). The sessions table stores only the SHA-256 of the token.
- **Self sign-up**: "Create account" tab → POST `/api/signup` → role 2, signed in. **New accounts start with no agents**
  (also admin-created users and the first admin): `AgentService.resolve()` returns null, the page shows the empty
  state (`body.no-agents`) and opens `#learn/first-agent`. Shown only while `app_config.auth.allowSignup` is true. 5 sign-ups per IP per hour (counted from activity_logs).
- Roles: **1 = admin** (`/admin.html`: every user, agents, calls, recordings, activity log, sign-ins, app settings,
  agent types & templates) and **2 = user** (own agents and data).
- Default account when `users` is empty: **admin / admin@123** (must change it).
- Passwords: scrypt (N=16384, r=8, p=1, 64 bytes) as `scrypt$salt$hash`, the same format as the old Node code, so old
  passwords still work (BouncyCastle `SCrypt`). 5 wrong passwords per username+IP in 5 min → locked (from `login_attempts`).
  Non-GET requests whose Origin host ≠ Host are rejected.
- Deleting a user is a soft delete (`deleted_at`, username freed as `name~deleted-<id>`). The last active admin can't be
  demoted, disabled or deleted. Admin read-only view of another user's data: any GET `/api/...?as=<userId>`.

## Agents, types & templates

- Each user has many agents. The **agent type** (`agent_types`: personal, **secretary = "Call Assistant (for a person)"**,
  support, telecom, hospital, banking, realestate, sales, appointment, collections, survey, hr, tutor, wellness, other) gives the
  default persona (`role`) and **greeting**; `needs_owner` makes "Works for" required; `default_calendar` turns the
  calendar on for new agents.
- **Templates** (`agent_templates`): persona, greeting, goal, steps, rules, summary focus, per type; one per type can be
  `is_default` (pre-selected). An agent points at one (`agents.template_id`), so admin edits reach every agent using it.
- Per-agent persona fields: `owner_name` (works for), `organization`, `owner_availability` (text the prompt uses) +
  `availability_plan` (JSON from the picker: {days:[1..7] Mon=1, from, to, tz, note}), `meeting_minutes` (calendar
  meeting length; NULL = app default), `greeting` (own first line; empty = the template's, else the type's).
- Text may use `{agent}`, `{owner}`, `{org}`; `[[ … ]]` is dropped when a value inside is empty
  (`TemplateService.render`, mirrored by `renderTpl` in app.js/admin.js for previews).
- Prompt role section (`TemplateService.rolePrompt`): user's own playbook > agent template > type role; then
  "You work for {owner}…", availability, description. The greeting goes into the `[call connected]` instruction.
- The page sends **`X-Agent-Id`** on every `/api/` request; `ApiFilter` resolves it (must belong to the user, else
  their default agent) into `Ctx.agent`. `AppConfigService.forAgent()` layers defaults.json ← app_config ← agent ← env.

## Run

```bash
./runScript.sh            # checks Node 22+ / Java 21+, builds the backend if its code or db/*.sql changed, starts both, opens Chrome
NO_OPEN=1 ./runScript.sh  # same, without opening a browser
```

- URL: http://localhost:8323. Ctrl+C stops both.
- **Logs** (`backend/src/main/resources/logback-spring.xml`, times UTC): only two files: `logs/backend.log`
  (everything: every request `← METHOD path status in N ms`, sign-ins, activity, OpenAI calls with timings/tokens, at
  DEBUG the caller words, replies and every SQL statement via logger `SQL`, hashes masked) and `logs/error.log` (WARN+,
  plus anything the JVM prints itself). Line = time · level · [requestId] · [user] · [agentId]. The request id (MDC, set in `ApiFilter`) is also the
  `X-Request-Id` header and `api_logs.request_id` / `activity_logs.request_id`. Levels: `LOG_LEVEL`, `SQL_LOG` in .env, or
  live via admin `GET/PUT /api/admin/log-level`. Slow SQL > 500 ms and slow requests > 3 s → WARN. Rotated into
  `logs/archive/`. Troubleshooting guide with all tables and SQL queries: `docs/Troubleshooting.md`. New code: log
  actions at INFO, details at DEBUG, never log secrets or the OpenAI key.
- Build only: `cd backend && mvn -q -DskipTests package` → `backend/target/smartai-backend.jar`
  (run it from the project folder: it reads `.env`, `config.json` and `data/` from the working directory).
- Needs `OPENAI_API_KEY` and `MYSQL_*` in `.env` (copy `.env.example`). `.env` is the only place for secrets.
- Best in **Chrome or Edge** (live captions use the Web Speech API). The Claude desktop in-app browser blocks the mic.

## File map

```
config.json            Seed for app_config on first start + server.port (frontend port).
db/schema.sql          All tables.     db/seed.sql   Agent types + templates (generated once from the old playbooks.js).
backend/pom.xml        Spring Boot 3.5.6, Java 21, starter-web + starter-jdbc, mysql-connector-j, bcprov (scrypt).
backend/src/main/resources/application.properties   Ports, datasource (UTC), .env import, app.home.
backend/src/main/resources/defaults.json            Default settings (bottom layer).
backend/src/main/java/com/telemune/smartai/
  SmartAiApplication.java   main.        Bootstrap.java   seeds app_config, creates the first admin.
  db/Db.java                schema + migrations + seed on start; query/one/count/exec/tx helpers.
  web/ApiFilter.java        sign-in check, origin check, admin-only, ?as=, X-Agent-Id → Ctx, api_logs.
  web/Ctx.java · ApiException.java · ErrorAdvice.java (every error is JSON {error}).
  util/J.java               JSON/map helpers (rows are Map<String,Object>).
  ai/OpenAiClient.java      HTTPS to OpenAI: chat (streamed + plain), speech, transcriptions, models.
  ai/Prompts.java           voices (10), emotions (20), languages (16), system prompt + tag protocol.
  service/                  AuthService, AgentService, TemplateService, PlaybookService, CallService,
                            CalendarService, MessageService, AppConfigService, LogService.
  api/                      AuthController, AgentController (+ /api/templates), ConfigController (config, settings,
                            models), VoiceController (chat SSE, tts, transcribe, summary), DataController (playbooks,
                            calls, calendar, messages), AdminController.
frontend/server.js     Static files + /api proxy + page guard.  frontend/package.json (no deps).
frontend/public/login.html   Sign in + Create account.
frontend/public/admin.html + admin.js   KPIs, users, 🧩 agent types & templates editor, ⚙️ settings, 🔐 sign-ins, 📜 log.
frontend/public/index.html   Layout + CSS (light/dark tokens): top menu, Call view (call card + summary card,
                             conversation, call summaries), My agents view (list + tabbed editor), dialogs.
frontend/public/app.js       Menu/tab routing, agent picker + summary, persona/availability/emergency editors, call flow,
                             speech in/out, tag parsing, messages, calendar, playbooks, call summaries.
frontend/public/motion.css + motion.js   Shared motion theme on all three pages: "Network" canvas background (`.net-bg`,
                             z-index -1, drawn by motion.js, colour --net-dot), glass cards rise in + lift on hover,
                             pill menu bar (.topnav, .tabs), bubbles pop in, typing dots (`showTyping()` in app.js while
                             phase = thinking), title shimmer, rings on `.btn-call`; off with prefers-reduced-motion.
frontend/public/telemune-mark.png / telemune-logo.svg   Logo (CSS mask, theme gradient) / favicon.
runScript.sh           One-command start of both apps.
docs/Troubleshooting.md  Log files, tracing a request, common problems, every table, ready SQL queries.
docs/                  TelemuneSmartAi-Guide.md (+ PDF, images/). Keep it in step when features change. PDF rebuild:
                       node docs/md2html.mjs docs/TelemuneSmartAi-Guide.md /tmp/guide.html, then Chrome headless
                       --print-to-pdf=docs/TelemuneSmartAi-Guide.pdf file:///tmp/guide.html
data/                  Call recordings only. Never wipe it.     logs/   backend.log + error.log (gitignored).
```

## API (all served by the backend, reached through the frontend)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login`, `/api/logout` | sign in (username, password, remember) / out |
| POST | `/api/signup` | self sign-up {name, username, email?, password, confirm, remember} |
| GET | `/api/auth-options`, `/api/health` | public: {allowSignup, appName, tagline} / {ok} |
| GET / POST | `/api/me`, `/api/me/password` | who is signed in / change own password {current, next} |
| GET / POST / PATCH / DELETE | `/api/agents[/:id]` | list {agents, currentId, types (with templates)} / create {name, type, templateId, ownerName, organization, availability, description} / update (same + isDefault) / delete |
| GET | `/api/templates` | active agent types with their active templates |
| GET | `/api/config` | models, voices, languages, emotions, `settings` (`currentAgent` = full agent card) |
| POST | `/api/settings` | auto-save the active agent: agent/models/calendar/emergency/**persona** {templateId, ownerName, organization, availability, greeting} → {settings, agent} |
| POST | `/api/chat` | SSE: `delta` {text}, `usage`, `error`, `done` |
| POST | `/api/tts`, `/api/transcribe`, `/api/summary` | mp3 / {text} / {summary, usage} |
| GET | `/api/models` | OpenAI models grouped {chat, stt, tts} (cached 10 min) |
| GET/POST/DELETE | `/api/playbooks[/:id]` | {types, saved} / add / delete (the user's own playbooks) |
| GET/POST/DELETE | `/api/calendar[/:id]`, GET `/api/calendar/calendar.ics`, `/:id.ics` | events (POST only when the calendar is on) |
| GET/POST/PATCH/DELETE | `/api/messages[/:id]` | current agent's messages (`?scope=all`, `?status=new\|done`) / add {callerName, callerNumber, urgency, message} / {status} / delete |
| GET/POST | `/api/calls`, `/api/calls/stats`, `/api/calls/:id` (GET/DELETE), `/:id/summary`, `/:id/recording` (GET/PUT) | call history |
| GET | `/api/admin/overview`, `/api/admin/logs?page&user`, `/api/admin/logins?page` | admin: totals + users / activity / sign-ins |
| POST/GET/PATCH/DELETE | `/api/admin/users[/:id]` | admin: users |
| GET / PUT | `/api/admin/config[/:section]` | admin: app_config |
| GET / PUT | `/api/admin/log-level` | admin: current log levels / change {logger: com.telemune or SQL, level} until restart |
| GET | `/api/admin/templates` | admin: all types + templates (+ how many agents use each) |
| POST / PUT | `/api/admin/types`, `/api/admin/types/:key` | admin: add / edit a type |
| POST / PUT / DELETE | `/api/admin/templates[/:id]` | admin: add / edit / delete a template |

## The reply tag protocol (important)

```
<intent:refund for caller tune charge><mood:angry><lang:Hinglish>[apologetic] Oh no, sorry about that. [curious] Which number is it?
<intent:end call><mood:satisfied><lang:English><hangup:yes>[grateful] Glad I could help, bye!
```

- `app.js` `readMeta()` pulls `<intent|mood|lang|hangup|calendar|message:…>` out of the stream; `flushSentence()` reads
  `[emotion]` and sends each sentence to TTS. `stripTags()` removes all tags before display/speech.
- `<calendar:TITLE|YYYY-MM-DDTHH:MM|MINUTES>` (calendar on) → POST `/api/calendar` → 📅 chip.
- `<message:CALLER NAME|CALLBACK NUMBER|normal or urgent|MESSAGE>` → `saveCallerMessage()` → POST `/api/messages` →
  📨 chip; also stored in the call transcript and `stats.messages`. There is no Messages screen for users (removed on
  request); the admin dashboard still counts new messages, and `/api/messages` still lists them.
- `<hangup:yes>` → finish speaking → `hangupDelayMs` → `endCall("caller said goodbye")`.
- The first turn is a hidden `[call connected]` user message; the prompt tells the agent to say its greeting.
- If you change `Prompts.system()`, keep these tags or update the parser.

## Listening, agent setup card, emergency, call flow

- **Barge-in:** while the agent speaks, `startBargeWatch()` keeps a recorder on the mic and `bargeTick()` watches its
  level against an echo floor; `conversation.bargeInMs` of speech above `max(bargeInLevel, floor×3, vad×2.5)` →
  `bargeIn()`: stop speaking/abort the stream, ✋ chip, keep that recording and switch to normal listening (`vadTick`).
- **Instant greeting:** `prepareGreeting()` (on agent load/save and after each call) fetches POST `/api/greeting`
  (agent → template → type greeting; translated once for non-English, cached) and its TTS audio; `startCall()` →
  `speakGreeting()` plays it at once (falls back to the LLM `[call connected]` turn if not ready in 6 s).
  The backend caches generated speech (LRU, 300 lines), so repeated lines cost nothing.
- **Reply speed:** speech is streamed (`GET /api/tts/stream?text&voice&emotion&lang&agentId`, played by an `<audio>`
  while it downloads; `enqueueSpeech()` creates the element so later sentences load ahead); the first chunk of a reply
  may end at a comma (`firstClause()`); `startEarlyTranscribe()` sends the recording after 0.4 s of silence so the text
  is ready when `responseDelayMs` (1000) ends. Measured: ~3.4 s from end of speech to the agent's voice with gpt-4.1-mini (the
  default since 2026-11-18; ~4.2 s with gpt-5.5, ~6.5 s before these changes).
- **Silence re-ask:** `conversation.silenceRetrySeconds` (8) / `silenceRetries` (2) in app_config (Admin → App settings).
  `vadTick()` → `silencePrompt()` sends a hidden `[no response]` turn; after the re-asks `[no response, end call]` and
  `state.silenceEnding` hangs up after that goodbye even without `<hangup:yes>`. Markers are filtered out of summaries.
- **Call card animation** (`drawViz()` canvas around `#avatar`): idle gradient ring, listening ripples, thinking spinning
  arc + orbit dots, speaking three wobbling blobs driven by the voice level. **Agent bubbles** show only
  "Name · time · ⏱ reply" (`renderTiming()` writes `.meta`; details in its title); no emotion chips on agent bubbles.
- **Speaking speed:** `agents.speech_speed` (0.5–2.0; `agent.speechSpeed` in settings), set in Voice & AI; applied as
  `audio.playbackRate` (pitch kept) to every sentence and the preview.

- Listening: per-utterance MediaRecorder + VAD → `/api/transcribe`; browser recognition only for live captions
  (`#interim` under the avatar, `showLive()`) / fallback. The caller's chat bubble is added only in `commitUtterance()`
  with the final text (no draft bubble, no "corrected" chip). The agent replies after `conversation.responseDelayMs` of silence.
- **📚 Tutorials = guided tours** (`#learn` opens the launcher pop-up `#learnModal` / `#tourGrid`): the `TOURS` array in
  app.js; each step has `target` (selector/array/fn), `title`, `text`, and `done()` (auto-advance when the user did it) or
  Next; also `ready`, `clickIn`, `before` (goTab/goCall), `warn`. Engine: `startTour` → `tourGo` → `tourTick` (200 ms:
  ring `.tour-ring` + card `.tour-card` placement, "Show me again") → `finishTour` (done ids in localStorage
  `tsa-tours-<userId>`, offers the next tour). Users with no agents get `startTour("first-agent")` on load. Keep the
  tours in step when element ids or flows change.
- Top menu buttons (`.topnav`): **🎙 Call** (`#call`, the main page), **🤖 My agents** (`#agents/<tab>`, hash routing,
  `route()` in app.js). My agents (`#manageView`) is a pop-up window (`#agentsModal`) over the call page; ✕, Escape or a
  click outside closes it (back to `#call`). Dialogs opened from it (New agent, type change, playbook) sit on top.
- Call page = basic info only: agent picker (`#agentPick`) on the call card, then the summary card (works for,
  organization, availability, language · voice, AI models, playbook picker `#pbPick`, feature chips). ✎ Edit agent →
  `#agents/profile`. Keep it simple: anything that edits an agent belongs in My agents.
- My agents = agent list (`#agentChips`, ＋ New agent) + the setup card with tabs: Profile (agent type `#pType` →
  approval dialog `#typeDialog` → PATCH `/api/agents/:id {type}`, which resets template, greeting, description,
  playbook, works for, organization, availability, calendar and emergency to defaults in one transaction (keeps name,
  language, voice, models), then the form reloads; template, works for,
  organization, what it's for, greeting + preview) · Voice & AI · Availability (day buttons, from/to, time zone, note) ·
  Calendar (switch, meeting length, events) · Emergency · Playbooks. Hero: name, 🎙 Call, ☆ Default, 🗑.
- Everything auto-saves (no Save button; `markDirty()` → `autoSave()` → POST `/api/settings`; persona payload carries
  description, availability text + availabilityPlan; calendar carries defaultDurationMin).
- Emergency contacts `{label, type: phone|email, number, keywords[]}` per agent (`emergency_rules.contact_type`);
  browser `detectEmergency()` → banner with tel: or mailto:; the prompt says "call" or "email".
- Call flow: `startCall` → greeting turn → listen → `sendUserText` (SSE) → `speakNext` → `afterAgentTurn` → `endCall`
  → `summarizeCall` → POST `/api/calls` (+ PUT recording).

## Settings reference (MySQL `app_config`; `config.json` only seeds it)

Edit in the admin dashboard, `PUT /api/admin/config/<section>`, or SQL. Per-agent values live in `agents`.
Sections/keys: `branding.*` (appName, tagline, footer, logo, favicon, theme.primary/secondary/tertiary) ·
`agent.defaultName/defaultLanguage/defaultVoice/maxReplyWords/maxAgentsPerUser/defaultPlaybookId` ·
`models.chat/tts/reasoningEffort/maxReplyTokens/maxSummaryTokens` · `speechToText.engine/model/vadThreshold/minSpeechMs/maxUtteranceSeconds` ·
`conversation.responseDelayMs/hangupDelayMs/historyTurnsSentToModel` · `history.pageSize/maxRecordingMB` ·
`calendar.enabled/defaultDurationMin` · `emergency.enabled/rules[]` · `auth.allowSignup/sessionHours/rememberDays`.
Env overrides: `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT`, `BACKEND_PORT`, `PORT`.
New tunables: `defaults.json` (+ `publicConfig()` in AppConfigService if the browser needs it).

## Conventions & preferences (from the project owner)

- **Git: commit the current state before every change, then commit the change** — everything must be recoverable.
  Never commit `.env`, `data/`, `backups/`, `logs/`, `backend/target/`.
- Settings and data go in MySQL. New tables/columns go in `db/schema.sql` (IF NOT EXISTS); for a new column on an
  existing table also add it to `Db.migrate()`. New ready-made types/templates go in `db/seed.sql`.
- Backend = Spring Boot (JdbcTemplate, no JPA); frontend = plain HTML/CSS/JS, no framework, no build step, no npm deps.
- Agent replies must sound **human and short**: 1–2 sentences, one question at a time, no bot phrases, no lists.
- Provider is **OpenAI** (owner's choice). Don't switch unless asked.
- Keep the light/dark theme working: colours are CSS variables (`--c1/--c2/--c3`, `--grad`). Don't hard-code colours.
- Don't delete anything in `data/` while testing — clean up only what your test created.

## Testing tips

- Backend: `cd backend && mvn -q -o -DskipTests package`, then restart with `./runScript.sh`.
  Frontend syntax: `node --check frontend/server.js frontend/public/app.js frontend/public/admin.js`.
- API tests with curl against `http://127.0.0.1:8324` and a cookie jar (sign up a throw-away user and delete it after:
  `DELETE FROM users WHERE id=…` cascades its agents, calls, messages and events; also clear its activity_logs,
  api_logs, login_attempts and `data/users/<id>/`).
- In the in-app browser the mic is blocked. Drive turns with `sendUserText("…")` after seeding `state.history`, or
  stub the mic before Start call:
  ```js
  navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const d = c.createMediaStreamDestination(); c.createOscillator().connect(d); return d.stream; };
  ```
- Chat/summaries/TTS cost real OpenAI tokens — keep test calls short and delete them afterwards.
