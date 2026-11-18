# TelemuneSmartAi

Talk to an AI voice agent through a web call button. Speech recognition runs in the browser; replies come from
OpenAI (streamed), and every sentence is spoken by OpenAI TTS in the emotion the agent chose for it.

Full guide: [docs/TelemuneSmartAi-Guide.md](docs/TelemuneSmartAi-Guide.md) (features, how it works, admin, database, settings, troubleshooting).

## Run

```bash
./runScript.sh
```

Needs **MySQL 8** running: put its login in `.env` (`MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`,
`MYSQL_DATABASE=ai-agent`). The database and all its tables are created on first start (`db/schema.sql`).

It checks Node 22+, installs dependencies, creates `.env` if missing (paste your `OPENAI_API_KEY`), starts the
server on **http://localhost:8323** and opens it in Chrome. Use `NO_OPEN=1 ./runScript.sh` to skip the browser.
Voice input needs **Chrome or Edge**.

## Sign in

Open http://localhost:8323 and sign in. First start creates **admin / admin@123** — change it right away
(you'll see a reminder). The admin lands on the **Admin dashboard** (all users, their agents, calls, summaries and
recordings; add users, reset passwords, make admin, disable, delete; app settings; activity log). Every other user only
sees their own agents, playbooks, calls and calendar.

New people can **Create account** on the login page (self sign-up; the admin can switch it off in ⚙️ App settings).

## Agents

Each user can make several agents (**🤖 My agents → ＋ New agent**): pick what it's for (Hospital & Healthcare,
Banking & Finance, HR & Recruiting, Telecom, Customer Support, Personal …), give it a name and a short description.
Every agent keeps its own name, voice, language, models, playbook, calendar and emergency numbers, so changing one
never changes another, or anyone else's.

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
  once you pause for 2 s. Live captions show while you talk, then the bubble is replaced with the accurate text
  (✏️ corrected). Say "I meant Saturday" and the agent updates the earlier detail.
- **Hang-up intent:** say bye / "that's all" / "disconnect" (any language) and the agent says goodbye and ends the call itself.
- **New call = fresh chat.** Every finished call is saved to **Call history** (bottom of the page, paginated).
  Click a call to see its full summary, stats, recording player and annotated transcript, download it, or delete it.
  Stored in MySQL (`calls`, `call_summaries`), recordings as files in `data/users/<userId>/recordings/`.
  Each call shows which agent took it. 🗑 on a row (or in the details) deletes the call, its summary and recording.
- **Call summaries panel** (under the chat): totals for calls, total talk time, tokens used (chat + summaries;
  voice/TTS isn't counted), average reply time and recordings. Click any of them, or Show calls, to open the list.

## Agent setup (left panel)

Choose the **playbook, language, voice, name, LLM, speech-to-text and text-to-speech models** (the lists come from
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
section. `config.json` only fills that table on first start and sets the port (`server.port`, restart to change).
The admin can change sign-up, session length and agents-per-user in the dashboard. See `CLAUDE.md` for every key.

## Secrets (.env)

`OPENAI_API_KEY` and the MySQL login (`MYSQL_*`). Optional overrides: `PORT`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`,
`OPENAI_REASONING_EFFORT`.

---
Powered by Telemune © 2027 · Designed by DJ
