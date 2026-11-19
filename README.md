# TelemuneSmartAi

Talk to an AI voice agent through a web call button. Speech recognition runs in the browser; replies come from
OpenAI (streamed), and every sentence is spoken by OpenAI TTS in the emotion the agent chose for it.

Full guide: [docs/TelemuneSmartAi-Guide.md](docs/TelemuneSmartAi-Guide.md) (features, how it works, admin, database, settings, troubleshooting).

Two separate applications, each with its own folder, settings, run script, logs and README, so they can be handed
to different teams and deployed apart:

| App | Folder | Team | Port | What it is |
|---|---|---|---|---|
| **Backend** | [`voice_ai_backend/`](voice_ai_backend/README.md) | backend | 8324 | Spring Boot 3.5, Java 21+, MySQL 8, OpenAI: every `/api` route |
| **Web** | [`voice_ai_web/`](voice_ai_web/README.md) | frontend | 8323 (http), 8443 (https) | Node 22+, plain HTML/CSS/JS, no packages: the pages, and forwards `/api/*` to the backend |

| | voice_ai_backend | voice_ai_web |
|---|---|---|
| Start | `./run.sh` | `./run.sh` |
| Settings | `.env` (secrets, MySQL, port, log levels; from `.env.example`) + `config.json` (first-start app settings) | `config.json` (`port`, `httpsPort`, `backendUrl`), optional `.env` |
| Requirements | JDK 21+, Maven, MySQL 8, OpenAI key (`pom.xml`) | Node 22+, openssl (`package.json`, no dependencies) |
| Logs | `logs/backend.log`, `logs/error.log` | `logs/web.log`, `logs/error.log` |
| Runtime files (not in git) | `data/` (recordings), `logs/`, `target/`, `.env` | `certs/` (HTTPS), `logs/`, `.env` |
| Docs | `README.md`, `Troubleshooting.md` (tables + SQL) | `README.md` (incl. HTTPS + trusting the certificate) |

One request id links both logs: `web.log` ends each line with `[id]`, the same id as in `backend.log`.

## Run

Both on this computer (development shortcut):

```bash
./runScript.sh            # starts voice_ai_backend, then voice_ai_web; opens Chrome. Ctrl+C stops both
NO_OPEN=1 ./runScript.sh  # without opening the browser
```

Or each on its own, from its folder: `cd voice_ai_backend && ./run.sh`, `cd voice_ai_web && ./run.sh`.
First time: `cp voice_ai_backend/.env.example voice_ai_backend/.env` and fill in `OPENAI_API_KEY` and the MySQL login.

Open **http://localhost:8323**. From other computers use the https address the web app prints
(e.g. `https://192.168.0.100:8443`): browsers allow the microphone only on https or localhost.
Voice input needs **Chrome or Edge**.

**Running them on different servers:** in voice_ai_web set `backendUrl` (config.json) to the backend's address; in
voice_ai_backend's `.env` set `BACKEND_HOST=0.0.0.0` and `TRUSTED_PROXIES=<web server IP>`, and let only the web server
reach port 8324.

## Sign in

Open http://localhost:8323 and sign in. First start creates **admin / admin@123** — change it right away
(you'll see a reminder). The admin lands on the **Admin dashboard** (all users, their agents, calls, summaries and
recordings; add users, reset passwords, make admin, disable, delete; 🧩 agent types & templates; app settings;
sign-in attempts; activity log). Every other user only
sees their own agents, playbooks, calls and calendar.

New people can **Create account** on the login page (self sign-up; the admin can switch it off in ⚙️ App settings).

## Agents

Each user can make several agents (**🤖 My agents → ＋ New agent**): pick the type (Call Assistant for a person,
Hospital & Healthcare, Banking & Finance, HR & Recruiting, Telecom, Customer Support, Personal …) and a template,
say who it **works for** and the organization, and give it a name. It goes step by step (Profile → Voice (with ▶ listen) → Playbook →
Availability → Calendar → Emergency → Review), then **✨ Create agent** with a progress bar; the Create-your-first-agent tutorial follows the same steps. Types and templates (persona, greeting, goal,
steps, rules) come from MySQL and the admin can edit them; agents use them live.

Example, a Call Assistant named Brown working for DJ:
*"Hello, this is Brown, DJ's assistant. DJ isn't available to take your call right now, but I can schedule a meeting
or pass a message on. Which would you like?"* It books the meeting into the calendar or takes the caller's message
(name, number, urgency), which is saved with the call.

Every agent keeps its own name, voice, language, models, persona and greeting, playbook, calendar, messages and
emergency numbers, so changing one never changes another, or anyone else's.

## Features

- **Playbooks:** none by default, so the agent runs as a general helpful agent. When a playbook is selected the Default row is hidden; click the selected playbook again to go back to default. **＋ Add playbook** →
  choose the agent type (Personal Assistant, Customer Support, Telecom Care, Hospital & Healthcare, Banking & Finance, Sales, Appointment Booking,
  Payment Reminder, Feedback Survey, HR & Recruiting, Tutor & Coach, Wellness, Other) → pick a ready-made
  template or **Custom** → edit and save. Click a playbook to use it, 🗑 to remove it. Saved in MySQL.
- **Per-turn insights:** caller intent, mood and language on each message, plus how long the agent took
  (first words, first voice, full reply). The bar at the top shows the latest intent, mood, language, average reply time and turns.
- **Emotional voice:** 20 emotions, 10 OpenAI voices (▶ Preview to hear one). The avatar colour and emoji follow the emotion.
- **Visuals:** a ring around the avatar reacts to your voice (green) and the agent's voice (emotion colour); orbiting dots while thinking.
- **Light / dark theme:** 🌙 / ☀️ button in the header (defaults to your system setting).
- **Recording:** ● records both sides as .webm.
- **Call summary:** when you hang up: summary, intent, mood, key details, action items, outcome, with downloads for the
  summary + annotated transcript (.txt) and the recording.
- Replies are short and human: one or two sentences, one question at a time.
- **Accurate listening:** your speech is recorded from the first word and transcribed by OpenAI (`gpt-4o-transcribe`)
  once you pause for 2 s. While you talk your bubble shows 🎙 ripples + "Listening…" and your words write in live; when
  you stop, the accurate text replaces them in place (changed words flash briefly). Say "I meant Saturday" and the agent updates the earlier detail.
- **Hang-up intent:** say bye / "that's all" / "disconnect" (any language) and the agent says goodbye and ends the call itself.
- **New call = fresh chat.** Every finished call is saved to **Call history** (bottom of the page, paginated).
  Click a call to see its full summary, stats, recording player and annotated transcript, download it, or delete it.
  Stored in MySQL (`calls`, `call_summaries`), recordings as files in `data/users/<userId>/recordings/`.
  Each call shows which agent took it. 🗑 on a row (or in the details) deletes the call, its summary and recording.
- **Call summaries panel** (under the chat): totals for calls, total talk time, tokens used (chat + summaries;
  voice/TTS isn't counted), average reply time and recordings. Click any of them, or Show calls, to open the list.

## Main page and menu

The top menu has **🎙 Call** (main page), **🤖 My agents** and **📚 Tutorials** (guided tours: the page highlights each step and waits while you do it). New accounts start with no agents and a guided tour walks them through creating the first one. The main page is kept simple: pick the
agent for the call, press Start call, and see its basics (works for, organization, availability, language, voice,
models, playbook). Everything else is edited under **🤖 My agents**, in tabs: Profile · Voice & AI · Availability
(days, hours, time zone) · Calendar (on/off, meeting length) · Emergency (contacts by phone or email) ·
Playbooks.

## Agent settings (🤖 My agents)

Edit the **🎭 persona & greeting** (template, works for, organization, availability, first line, with a preview),
choose the **playbook, language, voice, name, LLM, speech-to-text and text-to-speech models** (the lists come from
your OpenAI account), switch the **calendar** on/off, and manage **emergency numbers**: each has a name, a number and
keywords you pick from a list or type yourself. Every change is saved to the selected agent automatically (MySQL);
the next reply uses the new setup.

- **Calendar on:** confirmed bookings and reminders go into the 📅 Calendar card (download one event or all as `.ics`
  for Google Calendar / Outlook / Apple Calendar).
- **Emergency:** if the caller says a keyword, a red 🚨 banner shows the number with a call link, and the agent tells
  them to call it right away.

## Settings

Shared settings (branding, theme, default models, speech-to-text sensitivity, reply wait time, hang-up delay, history
page size, recording limit, sign-up and session length) live in the MySQL table `app_config`, one JSON document per
section. `voice_ai_backend/config.json` only fills that table on first start; after that use Admin → App settings.
Secrets (`OPENAI_API_KEY`, `MYSQL_*`) are only in `voice_ai_backend/.env`. See `CLAUDE.md` for every key.

## Logs & troubleshooting

- Backend: `voice_ai_backend/logs/backend.log` (everything: requests, sign-ins, actions, OpenAI calls, the caller's words,
  the agent's replies, every SQL statement) and `logs/error.log` (problems only, look here first).
- Web: `voice_ai_web/logs/web.log` (one line per request) and `logs/error.log`.
- Each line carries a request id, also in the `X-Request-Id` header and the `api_logs` / `activity_logs` tables.
  Tables and ready SQL queries: [voice_ai_backend/Troubleshooting.md](voice_ai_backend/Troubleshooting.md).

---
Powered by Telemune © 2027 · Designed by DJ
