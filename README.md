# TelemuneSmartAi

Talk to an AI voice agent through a web call button. Speech recognition runs in the browser; replies come from
OpenAI (streamed), and every sentence is spoken by OpenAI TTS in the emotion the agent chose for it.

## Run

```bash
./runScript.sh
```

It checks Node 22+, installs dependencies, creates `.env` if missing (paste your `OPENAI_API_KEY`), starts the
server on **http://localhost:8323** and opens it in Chrome. Use `NO_OPEN=1 ./runScript.sh` to skip the browser.
Voice input needs **Chrome or Edge**.

## Sign in

Open http://localhost:8323 and sign in. First start creates **admin / admin@123** — change it right away
(you'll see a reminder). The admin lands on the **Admin dashboard** (all users, their agents, calls, summaries and
recordings; add users, reset passwords, make admin, disable, delete). Every other user only sees their own agent,
playbooks, calls and calendar.

## Features

- **Playbooks:** none by default, so the agent runs as a general helpful agent. When a playbook is selected the Default row is hidden; click the selected playbook again to go back to default. **＋ Add playbook** →
  choose the agent type (Personal Assistant, Customer Support, Telecom Care, Sales, Appointment Booking,
  Payment Reminder, Feedback Survey, HR & Recruiting, Tutor & Coach, Wellness, Other) → pick a ready-made
  template or **Custom** → edit and save. Click a playbook to use it, 🗑 to remove it. Saved in `data/playbooks.json`.
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
  Stored in `data/calls.json`; every summary is also saved as its own text file in `data/summaries/<id>.txt`,
  recordings in `data/recordings/`. 🗑 on a row (or in the details) deletes the call, its summary file and recording.
- **Call summaries panel** (under the chat): totals for calls, total talk time, tokens used (chat + summaries;
  voice/TTS isn't counted), average reply time and recordings. Click any of them, or Show calls, to open the list.

## Agent setup (left panel)

Choose the **playbook, language, voice, name, LLM, speech-to-text and text-to-speech models** (the lists come from
your OpenAI account), switch the **calendar** on/off, and manage **emergency numbers**: each has a name, a number and
keywords you pick from a list or type yourself. Every change is saved to `config.json` automatically; the next
reply uses the new setup.

- **Calendar on:** confirmed bookings and reminders go into the 📅 Calendar card (download one event or all as `.ics`
  for Google Calendar / Outlook / Apple Calendar).
- **Emergency:** if the caller says a keyword, a red 🚨 banner shows the number with a call link, and the agent tells
  them to call it right away.

## config.json

Everything you might want to change lives here: port, branding (name, tagline, logo, footer, theme colours), speech-to-text (engine, model, sensitivity), agent defaults
(name, language, voice, reply length), models, reply wait time, hang-up delay, history page size and recording limit.
See `CLAUDE.md` for what each key does. Most edits apply on the next page load; `server.port` needs a restart.

## Secrets (.env)

Only `OPENAI_API_KEY`. Optional overrides: `PORT`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT`.

---
Powered by Telemune © 2027 · Designed by DJ
