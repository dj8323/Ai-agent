# TelemuneSmartAi — project guide

A multilingual **AI voice agent** you talk to from the browser with a call button. The caller speaks, the agent
answers out loud with an emotional voice, and every call gets a summary, stats and an optional recording.
Branding: "TelemuneSmartAi", footer "Powered by Telemune © 2027 · Designed by DJ".

## Accounts & roles (read this first)

- Sign-in is required for everything. `/login.html` → POST `/api/login` → HttpOnly `tsa_session` cookie
  (12 h, or 30 days with "Keep me signed in"). Signed-out visits to `/`, `/index.html`, `/admin.html` redirect to login;
  `/api/*` returns 401 (the pages then go to the login page).
- Roles: **1 = admin** (lands on `/admin.html`: every user, their agents, calls, summaries, recordings; add / reset
  password / make admin / disable / delete users) and **2 = user** (only their own agent and data).
- Default account created on first start: **admin / admin@123** (flagged `mustChangePassword`; a banner asks to change it).
  Users created by the admin also get a temporary password they must change.
- Passwords: scrypt hashes in `data/users.json`. Sessions: SHA-256 of the token in `data/sessions.json`.
  5 wrong passwords per username+IP → 5-minute lockout. Non-GET requests from another origin are rejected.
- **Per-user data**: `data/users/<userId>/` holds `settings.json` (that user's agent, models, speechToText, calendar,
  emergency), `playbooks.json`, `calls.json`, `summaries/`, `recordings/`, `calendar.json`.
  `config.json` is now the shared default for every user (plus server/branding/history settings).
- How code finds the user: `context.js` keeps the request's user in AsyncLocalStorage; `config.js`, `playbooks.js`,
  `calls.js`, `calendar.js` resolve paths with `userDataDir()`. Never read `data/*.json` directly for user data.
- Admin read-only access to another user's data: any GET `/api/...?as=<userId>` (ignored for non-admins).
- Deleted users' folders are moved to `data/deleted-users/` (not erased). The last active admin can't be demoted,
  disabled or deleted, and admins can't remove their own access.
- The original single-user data was moved into the admin account on first start; a copy is in
  `backups/pre-login-2026-11-17/`.

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
| Storage | JSON + files under `data/` |

## File map

```
config.json        Shared settings + the DEFAULT agent setup for every user (each user's own setup is in their folder).
auth.js            Users, roles, scrypt passwords, sessions, login lockout, first-start admin + data migration.
context.js         Per-request user (AsyncLocalStorage) → userDataDir(); asUser() for admin roll-ups.
config.js          Loads config.json over defaults; env overrides; publicConfig() = what the browser may see;
                   saveAgentSettings() = the whitelisted write-back used by the 💾 Save agent button.
calendar.js        Local calendar (data/calendar.json) + .ics export.
server.js          HTTP server + API routes, system prompt, voices (10), emotions (20), languages (15).
playbooks.js       AGENT_TYPES (11 types, each with ready-made templates) + saved playbooks CRUD + playbookPrompt().
calls.js           Call history CRUD, per-call summary .txt files, recordings, totals (callStats).
public/login.html  Sign-in page (split brand panel + form).
public/admin.html  Admin dashboard (+ public/admin.js): KPIs, user cards, add/reset/role/disable/delete, user drawer
                   with agent setup, playbooks, paginated calls and full call view (summary, transcript, recording).
public/index.html  Layout + all CSS (theme tokens for light/dark), dialogs, user menu (dashboard / password / sign out).
public/app.js      Everything in the browser: call flow, speech in/out, tag parsing, visualizer, recording,
                   playbook manager, call summaries panel + pagination.
public/telemune-mark.png   Official Telemune snowflake (from telemune.com). Used as a CSS mask filled with the theme
                           gradient (`.logo` in index.html), so it always matches branding.theme.
public/telemune-logo.svg   Same mark, gradient baked in — the browser-tab icon (favicon).
public/logo.svg            Old waveform logo, no longer used.
runScript.sh       One-command start.
data/              USER DATA — users.json, sessions.json, users/<userId>/…, deleted-users/. Never wipe it.
```

## API

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/login`, `/api/logout` | sign in (body: username, password, remember) / out |
| GET / POST | `/api/me`, `/api/me/password` | who is signed in / change own password {current, next} |
| GET | `/api/admin/overview` | admin: totals + every user with agent summary and stats |
| POST / GET / PATCH / DELETE | `/api/admin/users[/:id]` | admin: create / detail / {name, role, password, disabled} / delete |
| GET | `/api/config` | models, voices, languages, emotions, `settings` (= `publicConfig`) |
| POST | `/api/chat` | SSE stream: `delta` {text}, `usage` {input,output,total}, `error`, `done` |
| POST | `/api/tts` | mp3 for {text, emotion, voice, lang} |
| POST | `/api/transcribe` | {audio: base64, mime, lang, context} → {text}. Context = agent's last line (helps accuracy) |
| POST | `/api/summary` | {summary, usage} |
| GET/POST/DELETE | `/api/playbooks[/:id]` | agent types + saved playbooks |
| GET | `/api/models` | models on the OpenAI account, grouped `{chat, stt, tts}` (cached 10 min; fallback list offline) |
| POST | `/api/settings` | Save agent: writes agent/models/speechToText/calendar/emergency into `config.json` |
| GET/POST/DELETE | `/api/calendar[/:id]` | list / add (only when calendar is on) / delete events |
| GET | `/api/calendar/calendar.ics`, `/api/calendar/:id.ics` | export all / one event |
| GET | `/api/calls?page=N` | paginated call list (no transcripts) |
| GET | `/api/calls/stats` | totals: calls, seconds, tokens, avg reply, recordings |
| GET/DELETE | `/api/calls/:id` | full call / delete call + its summary file + recording |
| POST | `/api/calls` | save a finished call (writes `data/summaries/<id>.txt`) |
| GET | `/api/calls/:id/summary` | the summary .txt |
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

- Compact "agent profile" card on the left, top to bottom: **AI name** (gradient header with mini avatar) →
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

## config.json reference

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
| `calendar.enabled / defaultDurationMin` | Let the agent add events / default length |
| `emergency.enabled / rules[]` | Emergency detection and the numbers + keywords (India defaults: 112, 108, 100, 101, 1091, 14416) |

Env overrides (optional): `PORT`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT`.
New tunables go in `config.json` + `DEFAULTS` in `config.js` (+ `publicConfig()` if the browser needs it).

## Conventions & preferences (from the project owner)

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
