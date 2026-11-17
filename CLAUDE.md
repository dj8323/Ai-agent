# TelemuneSmartAi — project guide

A multilingual **AI voice agent** you talk to from the browser with a call button. The caller speaks, the agent
answers out loud with an emotional voice, and every call gets a summary, stats and an optional recording.
Branding: "TelemuneSmartAi", footer "Powered by Telemune © 2027 · Designed by DJ".

## Storage = MySQL (read this first)

- Everything lives in MySQL, database **`ai-agent`** (connection in `.env`: `MYSQL_HOST/PORT/USER/PASSWORD/DATABASE`).
  `db/schema.sql` creates the database and all tables; `db.js` runs it on every start (all `IF NOT EXISTS`).
  Connections use `time_zone = '+00:00'`: every DATETIME is UTC.
- Tables: `roles` (1 admin, 2 user) · `users` · `sessions` · `app_config` (shared settings, one JSON per section) ·
  `agents` + `emergency_rules` (each agent's own setup) · `playbooks` · `calls` + `call_summaries` ·
  `calendar_events` · `activity_logs` (who did what) · `api_logs` (every API request: path, status, ms).
- Only call recordings stay on disk: `data/users/<userId>/recordings/<file>` (file name in `calls.recording_file`).
- `migrate.js` imported the old JSON storage once (2026-11-17); a full copy is in `backups/pre-mysql-2026-11-17/`.
  Older copy (before accounts): `backups/pre-login-2026-11-17/`.
- No Spring Boot or other backend: Node talks to MySQL directly with `mysql2` (the only other dependency).

## Accounts & roles

- Sign-in is required for everything. `/login.html` → POST `/api/login` → HttpOnly `tsa_session` cookie
  (`app_config.auth.sessionHours`, or `rememberDays` with "Keep me signed in"). Signed-out visits to `/`, `/index.html`,
  `/admin.html` redirect to login; `/api/*` returns 401 (the pages then go to the login page).
- **Self sign-up**: "Create account" tab on the login page → POST `/api/signup` (name, username, optional email,
  password, confirm) → role 2, signed in straight away, gets a starter Personal Assistant agent. Shown only while
  `app_config.auth.allowSignup` is true (switch in the admin dashboard → ⚙️ App settings). 5 sign-ups per IP per hour.
- Roles: **1 = admin** (lands on `/admin.html`: every user, all their agents, calls, summaries, recordings, the activity
  log and app settings; add / reset password / make admin / disable / delete users) and **2 = user** (own agents and data).
- Default account created when `users` is empty: **admin / admin@123** (flagged `must_change_password`).
  Users created by the admin also get a temporary password they must change.
- Passwords: scrypt hashes. Sessions: SHA-256 of the token. 5 wrong passwords per username+IP → 5-minute lockout.
  Non-GET requests from another origin are rejected.
- Deleting a user is a soft delete (`deleted_at` set, username freed as `name~deleted-<id>`); their rows stay.
  The last active admin can't be demoted, disabled or deleted, and admins can't remove their own access.
- Admin read-only access to another user's data: any GET `/api/...?as=<userId>` (ignored for non-admins).

## Agents (many per user)

- Each user can create agents for different jobs (**＋ New agent**: Personal, Customer Support, Telecom, Hospital &
  Healthcare, Banking & Finance, Sales, Appointment, Payment Reminder, Survey, HR, Tutor, Wellness, Other). The type
  sets the agent's role when no playbook is picked (`playbookPrompt(pb, agent)`); "What it's for" is added to the prompt.
- Each agent has its own name, language, voice, LLM/STT/TTS, playbook, calendar switch and emergency numbers.
  Saving one agent never touches another agent or another user. Playbooks belong to the user; any agent can pick one.
- The page sends **`X-Agent-Id`** on every `/api/` request (fetch wrapper in app.js). `server.js` resolves it with
  `resolveAgent()` (must belong to the user, else their default agent) into the request context; `getConfig()` then
  layers DEFAULTS ← `app_config` ← that agent's row. Calls and calendar events record `agent_id` + agent name.
- Last-opened agent per user is kept in localStorage (`tsa-agent-<userId>`); ★ Default opens first otherwise.
- How code finds the user/agent: `context.js` (AsyncLocalStorage) → `currentDataUserId()`, `currentAgent()`.

## Run

```bash
./runScript.sh            # checks Node 22+, installs deps, checks .env, starts on config port, opens Chrome
NO_OPEN=1 ./runScript.sh  # same, without opening a browser
npm start                 # just the server
```

- URL: http://localhost:8323 (port = `server.port` in `config.json`; read only at startup → restart to change).
- Needs `OPENAI_API_KEY` in `.env` (copy `.env.example`). `.env` is the only place for secrets.
- Best in **Chrome or Edge** (live captions use the Web Speech API; OpenAI STT works in any browser with a mic).
  The Claude desktop in-app browser blocks the mic.

## Stack

Plain Node (ESM, Node 22+) with `node:http` — no framework, no build step. Only dependency: `openai`.
Front end is static HTML/CSS/JS in `public/` (no bundler, no framework).

| Piece | How |
|---|---|
| Speech → text | Mic recorded per utterance + voice-activity detection → OpenAI `gpt-4o-transcribe` (`/api/transcribe`). Browser `SpeechRecognition` runs alongside only for live captions / fallback |
| Thinking | OpenAI Chat Completions, streamed over SSE (`/api/chat`) |
| Text → speech | OpenAI TTS (`gpt-4o-mini-tts`), one request per sentence, with emotion `instructions` (`/api/tts`) |
| Summary | OpenAI Chat Completions, non-streamed (`/api/summary`) |
| Storage | MySQL `ai-agent` via `mysql2` (recordings as files under `data/users/<id>/recordings/`) |

## File map

```
config.json        Seed for app_config on first start + server.port (read before the DB connects). Not read after that.
db/schema.sql      All tables (run by db.js on start, or by hand: mysql -uroot -p < db/schema.sql).
db.js              MySQL pool (UTC), initDb(), query/one/exec/tx helpers.
migrate.js         One-time import of the old JSON files into MySQL (+ backup).
auth.js            Users, roles, scrypt passwords, sessions, login lockout, sign-up, first-start admin.
agents.js          Agents CRUD, resolveAgent(), saveAgentSettings() (the auto-save target), emergency rules.
logs.js            logActivity(), logRequest(), listActivity(), apiStats().
context.js         Per-request user, data user and agent (AsyncLocalStorage); asUser() for admin roll-ups.
config.js          DEFAULTS ← app_config ← active agent ← env; publicConfig() = what the browser may see;
                   seedAppConfig(), saveAppSection() (admin), bootPort().
calendar.js        Calendar events (calendar_events) + .ics export.
server.js          HTTP server + API routes, system prompt, voices (10), emotions (20), languages (15).
playbooks.js       AGENT_TYPES (13 types, each with ready-made templates) + saved playbooks CRUD + playbookPrompt().
calls.js           Call history CRUD (calls + call_summaries), recordings on disk, totals (callStats).
public/login.html  Sign-in + Create account (split brand panel + form).
public/admin.html  Admin dashboard (+ public/admin.js): KPIs, user cards with all their agents, add/reset/role/disable/
                   delete, user drawer (agents, playbooks, calls, call view), ⚙️ App settings, 📜 Activity log.
public/index.html  Layout + all CSS (theme tokens for light/dark), dialogs (incl. New agent), user menu.
public/app.js      Everything in the browser: My agents switcher, call flow, speech in/out, tag parsing, visualizer,
                   recording, playbook manager, call summaries panel + pagination.
public/telemune-mark.png   Official Telemune snowflake (from telemune.com). Used as a CSS mask filled with the theme
                           gradient (`.logo` in index.html), so it always matches branding.theme.
public/telemune-logo.svg   Same mark, gradient baked in — the browser-tab icon (favicon).
public/logo.svg            Old waveform logo, no longer used.
runScript.sh       One-command start.
data/              Call recordings only (data/users/<userId>/recordings/). Never wipe it.
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login`, `/api/logout` | sign in (body: username, password, remember) / out |
| POST | `/api/signup` | self sign-up {name, username, email?, password, confirm, remember} (when allowed) |
| GET | `/api/auth-options` | public: {allowSignup, appName, tagline} for the login page |
| GET / POST / PATCH / DELETE | `/api/agents[/:id]` | list {agents, currentId, types} / create {name, type, description} / {name, description, type, isDefault} / delete |
| GET / POST | `/api/me`, `/api/me/password` | who is signed in / change own password {current, next} |
| GET | `/api/admin/overview` | admin: totals + every user with agent summary and stats |
| POST / GET / PATCH / DELETE | `/api/admin/users[/:id]` | admin: create / detail / {name, role, password, disabled} / delete |
| GET | `/api/admin/logs?page=N&user=ID` | admin: activity log (15 per page) |
| GET / PUT | `/api/admin/config[/:section]` | admin: all app_config sections / replace one section (JSON object) |
| GET | `/api/config` | models, voices, languages, emotions, `settings` (= `publicConfig`) |
| POST | `/api/chat` | SSE stream: `delta` {text}, `usage` {input,output,total}, `error`, `done` |
| POST | `/api/tts` | mp3 for {text, emotion, voice, lang} |
| POST | `/api/transcribe` | {audio: base64, mime, lang, context} → {text}. Context = agent's last line (helps accuracy) |
| POST | `/api/summary` | {summary, usage} |
| GET/POST/DELETE | `/api/playbooks[/:id]` | agent types + saved playbooks |
| GET | `/api/models` | models on the OpenAI account, grouped `{chat, stt, tts}` (cached 10 min; fallback list offline) |
| POST | `/api/settings` | Save the active agent (X-Agent-Id): name/language/voice/playbook/models/calendar/emergency |
| GET/POST/DELETE | `/api/calendar[/:id]` | list / add (only when calendar is on) / delete events |
| GET | `/api/calendar/calendar.ics`, `/api/calendar/:id.ics` | export all / one event |
| GET | `/api/calls?page=N&agent=ID` | paginated call list (no transcripts), optionally one agent's |
| GET | `/api/calls/stats` | totals: calls, seconds, tokens, avg reply, recordings |
| GET/DELETE | `/api/calls/:id` | full call / delete call + its summary + recording |
| POST | `/api/calls` | save a finished call (calls + call_summaries rows) |
| GET | `/api/calls/:id/summary` | the summary as a .txt download (call_summaries.full_text) |
| GET/PUT | `/api/calls/:id/recording` | recording download / upload (raw body) |

## The reply tag protocol (important)

The model must start every reply with metadata tags and prefix every sentence with an emotion:

```
<intent:refund for caller tune charge><mood:angry><lang:Hinglish>[apologetic] Oh no, sorry about that. [curious] Which number is it?
<intent:end call><mood:satisfied><lang:English><hangup:yes>[grateful] Glad I could help, bye!
```

- `app.js` `readMeta()` pulls `<intent|mood|lang|hangup:…>` out of the stream; `flushSentence()` reads `[emotion]`
  and sends each finished sentence to TTS. `stripTags()` removes all tags (also half-streamed ones) before display/speech.
- History sent back to the model keeps the tags so the format stays consistent.
- `<calendar:TITLE|YYYY-MM-DDTHH:MM|MINUTES>` (only when calendar is on) → `addCalendarEvent()` → POST `/api/calendar`
  → 📅 chip on the reply + refresh of the event list in the Calendar section.
- `<hangup:yes>` → agent finishes speaking → waits `hangupDelayMs` → `endCall("caller said goodbye")`.
- The first turn is a hidden `[call connected]` user message so the agent greets first.
- If you change the prompt in `server.js systemPrompt()`, keep these tags or update the parser.

## Listening (why words aren't missed)

1. `startListening` → `startUtterance()` starts a `MediaRecorder` on the mic immediately, plus browser recognition
   for live captions, plus `vadTick()` every 50 ms (RMS of a mic-only analyser vs `speechToText.vadThreshold`).
2. Caller speaks → a "live" user bubble shows captions (italic, ●●●). Chrome recognition restarts instantly on `onend`
   and keeps earlier text (`srBase`), so nothing is dropped between sessions.
3. Silence for `conversation.responseDelayMs` after ≥ `minSpeechMs` of voice → `commitUtterance()`:
   stop recorder → `/api/transcribe` → replace the live bubble with the accurate text (✏️ corrected chip if it
   differs; hover shows what captions heard) → `sendUserText(text, { bubble, t0 })`.
4. STT off/failing → browser caption text is used. Pure noise (no letters) → bubble removed, keep listening.
5. Prompt rules: the agent treats later corrections ("I meant Saturday") as the truth and confirms them, and
   checks back when a word looks misheard.

## Agent setup card (auto-saves)

- Compact "agent profile" card on the left, top to bottom: **🤖 My agents** (chips to switch, ＋ New agent, ✎ About,
  ☆ Default, 🗑; switching is locked during a call) → **AI name** (gradient header with mini avatar) →
  **AI models** (LLM · STT · TTS in one row) → **Voice & language** (one row + ▶ preview) → **Playbook** →
  **📅 Calendar** section (switch + the calendar's events and .ics export live inside it) →
  **🚨 Emergency** section (collapsed). Switching it on shows only the **＋ Add emergency number** form:
  "Related to" (`EMERGENCY_TYPES` in app.js: Ambulance, Police, Fire, Women/Mental-health/Child helplines,
  Disaster, All emergencies, Other) → number pre-filled (editable) → keyword suggestions to tap + typed keywords.
  Adding the same service again updates it instead of duplicating. Saved numbers sit in a closed "Saved numbers" list.
  Everything about a feature stays in its own section — no separate Calendar card elsewhere on the page.
- No Save button: every change auto-saves. `markDirty()` debounces (150 ms for selects/switches, 700 ms while typing)
  → `autoSave()` → POST `/api/settings` → `saveAgentSettings()` rewrites only those keys in `config.json`.
  Status pill in the header: "Saving…" → "✓ Saved" (or "⚠ …" on error).
- A half-filled emergency number stays on screen and is saved once it has a name, number and keyword.
- The server reads config on every request, so new models/calendar/emergency rules apply to the next reply.
- `tts-1*` models: no emotion instructions and an older voice set — the server falls back to `alloy` when needed.

## Restarting / "server is older than the page"

- Static files are read from disk on every request, but server code loads only at start. After editing
  `server.js`, `config.js`, `calls.js`, `calendar.js` or `playbooks.js`, **restart the server**.
- `/api/config` returns `stale: true` when those files changed after start; the page then shows an orange banner.
  Unknown `/api/*` routes return JSON 404 (never an empty body), and auto-save shows "Restart the server to save".
- `./runScript.sh` restarts an older copy of this app on the same port by itself (it only kills a `server.js`
  process whose working directory is this project; anything else on the port → it stops with a message).
- Config writes are queued and atomic (temp file + rename), so concurrent saves can't corrupt `config.json`.

## Emergency

- Rules: `{ label, number, keywords[] }` in `config.json → emergency.rules`, added through the form above.
- Browser `detectEmergency()` checks each caller message (word-boundary match for Latin text, substring for other
  scripts; longest keyword wins) → red 🚨 banner with a `tel:` link, and sends `emergency` with the chat request.
- Server adds a system note so the reply leads with the number; the prompt also lists all rules so the model spots
  emergencies described in other words or languages. Emergencies are saved in the call transcript/summary.

## Call flow (browser)

`startCall` → clear chat, open mic + audio mixer (analyser for the visualizer, MediaStreamDestination for recording)
→ hidden greeting turn → **listen** (continuous recognition; reply only after `responseDelayMs` of silence)
→ `sendUserText` (stream, parse tags, queue sentences) → `speakNext` (TTS fetched ahead, played in order, routed through
the mixer) → `afterAgentTurn` (listen again or hang up) → `endCall` → stop recording → `summarizeCall` → save to
`/api/calls` (+ upload recording) → refresh Call summaries panel.

Per-turn timing: `firstText` (first words on screen), `firstVoice` (first audio starts), `total` (stream done).
Tokens: summed from the chat `usage` events + summary usage (TTS isn't counted — OpenAI doesn't report it).

## Settings reference (MySQL `app_config`; `config.json` only seeds it)

Edit with the admin dashboard (⚙️ App settings), `PUT /api/admin/config/<section>`, or SQL
(`UPDATE app_config SET value = JSON_SET(value, '$.pageSize', 8) WHERE section = 'history'`). Per-agent values
(name, language, voice, models, calendar, emergency) live in `agents` / `emergency_rules`.

| Key | Meaning |
|---|---|
| `server.port` | HTTP port (8323). Restart needed. |
| `branding.appName / tagline / footer` | Header title, subtitle, footer text |
| `branding.logo` | Logo shape in `public/` (transparent PNG/SVG); it's painted with the theme gradient |
| `branding.favicon` | Browser-tab icon file in `public/` |
| `branding.theme.primary / secondary / tertiary` | Brand colours (violet / pink / cyan) → CSS `--c1/--c2/--c3`, used by gradients everywhere |
| `agent.defaultName / defaultLanguage / defaultVoice` | Used until the user picks their own (saved in the browser) |
| `agent.maxReplyWords` | Target length of spoken replies |
| `models.chat / tts / reasoningEffort` | OpenAI models. `reasoningEffort` is dropped automatically for non gpt-5/o models |
| `models.maxReplyTokens / maxSummaryTokens` | Output caps |
| `speechToText.engine` | `"openai"` (accurate, recommended) or `"browser"` (Chrome captions only) |
| `speechToText.model` | OpenAI transcription model (`gpt-4o-transcribe`; `gpt-4o-mini-transcribe` is cheaper) |
| `speechToText.vadThreshold` | Mic loudness counted as speech (raise in noisy rooms, lower for quiet speakers) |
| `speechToText.minSpeechMs / maxUtteranceSeconds` | Min voice before a reply can trigger / max length of one utterance |
| `conversation.responseDelayMs` | Silence to wait before the agent replies (2000) |
| `conversation.hangupDelayMs` | Pause after the goodbye before disconnecting |
| `conversation.historyTurnsSentToModel` | How many recent messages go to the model |
| `history.pageSize / maxRecordingMB` | Call summaries per page, upload limit |
| `agent.defaultPlaybookId` | Playbook selected when the page loads ("" = default agent) |
| `calendar.enabled / defaultDurationMin` | Calendar default for new agents / default event length |
| `auth.allowSignup` | Show "Create account" on the login page (self sign-up) |
| `auth.sessionHours / rememberDays` | Sign-in length without / with "Keep me signed in" |
| `agent.maxAgentsPerUser` | Most agents one user can create (20) |
| `emergency.enabled / rules[]` | Emergency detection and the numbers + keywords (India defaults: 112, 108, 100, 101, 1091, 14416) |

Env overrides (optional): `PORT`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT`.
New tunables go in `config.json` + `DEFAULTS` in `config.js` (+ `publicConfig()` if the browser needs it).

## Conventions & preferences (from the project owner)

- **Git: commit the current state before every change, then commit the change** — everything must be recoverable.
  Never commit `.env`, `data/` or `backups/`.
- Settings and data go in MySQL, not JSON files. New tables/columns go in `db/schema.sql` (keep it `IF NOT EXISTS`;
  for a new column on an existing table add an idempotent migration in `db.js`).

- Agent replies must sound **human and short**: 1–2 sentences, one question at a time, no bot phrases, no lists.
- Provider is **OpenAI** (owner's choice). Don't switch to another provider unless asked.
- Anything someone might want to change belongs in `config.json`, not hard-coded.
- Default mode = no playbook. When a playbook is selected the "Default" row is hidden; clicking the selected
  playbook again returns to default.
- Keep the light/dark theme working: colours are CSS variables on `:root` (light) with dark overrides
  (`prefers-color-scheme` and `[data-theme="dark"]`). Brand colours are `--c1/--c2/--c3` and `--grad`.
  Don't hard-code colours in new UI.
- Keep it dependency-free on the front end; no build step.
- Don't delete anything in `data/` while testing — clean up only what your test created.

## Testing tips

- Syntax check: `node --check server.js config.js calls.js playbooks.js public/app.js`
- In the in-app browser the mic is blocked. To exercise a full call, stub the mic before clicking Start call:
  ```js
  navigator.mediaDevices.getUserMedia = async () => { const c = new AudioContext(); const d = c.createMediaStreamDestination(); c.createOscillator().connect(d); return d.stream; };
  ```
  then after the call starts: `state.recognition.start = () => {}; state.recognition.abort = () => {};`
  and drive turns with `sendUserText("…")`.
- To test real listening/STT: make the fake mic a `MediaStreamDestination`, generate a sentence with `/api/tts`,
  decode it and play it into that destination after the agent's greeting — the recorder, VAD and `/api/transcribe`
  then run exactly as with a real voice. Note `endCall` stops the mic tracks, so make a new destination per call.
- Summaries/TTS cost real OpenAI tokens — keep test calls short and delete them afterwards (🗑 or `DELETE /api/calls/:id`).
