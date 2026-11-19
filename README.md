# TelemuneSmartAi

Talk to an AI voice agent through a web call button. Speech recognition runs in the browser; replies come from
OpenAI (streamed), and every sentence is spoken by OpenAI TTS in the emotion the agent chose for it.

Full guide: [docs/TelemuneSmartAi-Guide.md](docs/TelemuneSmartAi-Guide.md) (features, how it works, admin, database, settings, troubleshooting).

Two applications:

| App | Folder | Port | |
|---|---|---|---|
| Backend | `backend/` | 8324 (this computer only) | Spring Boot 3.5, Java 21+: every `/api` route, MySQL, OpenAI |
| Frontend | `frontend/` | 8323 | Node 22+, no packages: the pages, and forwards `/api/*` to the backend |

## Run

```bash
./runScript.sh
```

Needs **MySQL 8** running: put its login in `.env` (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
`MYSQL_DATABASE=ai-agent`). The database and all its tables are created on first start (`db/schema.sql`).

It checks Java 21+ and Node 22+, creates `.env` if missing (paste your `OPENAI_API_KEY`), builds the backend with
Maven when its code changed, starts the backend (logs: `logs/backend.log`, `logs/error.log`) and the frontend on **http://localhost:8323**,
and opens it in Chrome. Use `NO_OPEN=1 ./runScript.sh` to skip the browser; Ctrl+C stops both.
Voice input needs **Chrome or Edge**.

**From other computers** use the https address runScript prints (e.g. `https://192.168.0.100:8443`): browsers allow
the microphone only on https or localhost. The certificate is made by `scripts/make-cert.sh` (in `certs/`, not in git);
the first visit shows a warning → Advanced → Proceed. How to trust it for good: guide, *Opening the app from other computers*.

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
say who it **works for** and the organization, and give it a name. Types and templates (persona, greeting, goal,
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
  once you pause for 2 s. Live captions show under the avatar while you talk; the chat shows only the accurate
  text, once it's ready. Say "I meant Saturday" and the agent updates the earlier detail.
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
section. `config.json` only fills that table on first start and sets the page port (`server.port`).
The admin can change sign-up, session length and agents-per-user in the dashboard. See `CLAUDE.md` for every key.

## Secrets (.env)

`OPENAI_API_KEY` and the MySQL login (`MYSQL_*`). Optional: `BACKEND_PORT` (8324), `PORT`, `OPENAI_MODEL`,
`OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT`.

---
Powered by Telemune © 2027 · Designed by DJ

## Logs & troubleshooting

Logs are in `logs/`: `backend.log` (everything: every request, sign-in, action, OpenAI call, the caller's words, the
agent's replies and every SQL statement) and `error.log` (problems only, look here first). Each line carries a request id that is also in the
`X-Request-Id` header and the `api_logs` / `activity_logs` tables. See [docs/Troubleshooting.md](docs/Troubleshooting.md)
for the tables and ready SQL queries.
