# TelemuneSmartAi — Product & Technical Guide

17 Nov 2026 · Dhananjay · Online version: https://claude.ai/artifact/CZ6KCE8PCPkDbrgop82cDo

## Contents

1. [Overview](#overview)
2. [Getting started](#getting-started)
3. [Accounts, roles and sign-up](#accounts-roles-and-sign-up)
4. [Agents](#agents)
5. [Agent setup card](#agent-setup-card)
6. [Making a call](#making-a-call)
7. [After the call: summaries, recordings and history](#after-the-call-summaries-recordings-and-history)
8. [Admin dashboard](#admin-dashboard)
9. [Data and storage](#data-and-storage)
10. [How it works (architecture)](#how-it-works-architecture)
11. [Settings, security and troubleshooting](#settings-security-and-troubleshooting)

## Overview

TelemuneSmartAi is a web app where you talk to AI voice agents through a call button in the browser: you speak, the agent answers out loud in a natural, emotional voice, and every call ends with a summary, statistics and an optional recording.

Each person signs in with their own account and can build several agents for different jobs: a personal assistant, a hospital front desk, a bank helpline, an HR recruiter and so on. Every agent keeps its own name, voice, language, AI models, script (playbook), calendar and emergency numbers. An admin sees every user, agent, call and log from one dashboard.

The app runs on one Node.js server at http://localhost:8323, stores its data in a MySQL database called `ai-agent`, and uses OpenAI for thinking, listening and speaking.

### Features at a glance

| Area | What you get |
| --- | --- |
| Accounts | Sign in, self sign-up (Create account), two roles: Admin and User, password change, lockout after 5 wrong tries |
| Agents | Many agents per user, 13 agent types (Hospital, Banking, HR, Telecom, Support, Sales and more), switch with one click |
| Voice calls | Web call button, live captions, accurate speech-to-text, emotional replies, automatic hang-up when the caller says goodbye |
| Languages | 16 languages incl. English, Hindi, Bengali, Tamil, Telugu, Marathi, Gujarati, Arabic, Spanish, French, German, Portuguese, Japanese, Mandarin and Jamaican Patois |
| Voices | 10 OpenAI voices, 20 emotions chosen sentence by sentence |
| Playbooks | Ready-made call scripts per agent type, or write your own; none selected = the agent's default role |
| Insights | Per-turn caller intent, mood, language and response time |
| After the call | AI summary, downloadable summary file, transcript, recording, token and time totals |
| Calendar | Agent can book events during a call; export as .ics for Google, Outlook or Apple Calendar |
| Emergency | Keyword detection with a red banner and the right helpline number (112, 108, 100, 101, 1091, 14416 …) |
| Admin | Dashboard with totals, user management, every agent and call, app settings, activity log |
| Storage | MySQL tables for users, roles, sessions, settings, agents, playbooks, calls, summaries, calendar and logs |
| Look | Telemune branding, light and dark theme, live voice visualizer |

## Getting started

One command starts everything: `./runScript.sh` in the `voice-assistant` folder, then open http://localhost:8323 in Chrome or Edge.

### What you need

| Item | Detail |
| --- | --- |
| Node.js | Version 22 or newer |
| MySQL | Version 8, running locally (the database and tables are created automatically) |
| OpenAI API key | From platform.openai.com; pays for chat, voice and transcription |
| Browser | Chrome or Edge for live captions; any browser with a microphone works for OpenAI speech-to-text |

### The .env file (secrets only)

```
OPENAI_API_KEY=sk-...
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=...
MYSQL_DATABASE=ai-agent
```

Copy `.env.example` to `.env` and fill it in. It is never committed to git.

### Starting the app

1. Run `./runScript.sh`. It checks Node, installs packages, checks `.env`, restarts any older copy of the app on the same port, starts the server and opens Chrome (`NO_OPEN=1 ./runScript.sh` skips the browser).
2. On first start the server creates the `ai-agent` database and all tables, copies the default settings from `config.json` into the database, and creates the admin account if there are no users.
3. Open http://localhost:8323. Signed-out visitors are sent to the login page.
4. Sign in as **admin / admin@123** and change the password straight away (a banner reminds you).

The port (8323) is set in `config.json` under `server.port`; changing it needs a restart. After editing server code, restart the server; the page shows an orange banner when the running server is older than the code.

## Accounts, roles and sign-up

Everyone must sign in, and each person sees only their own agents and calls; only an admin sees everyone.

### Two roles

| Role | Number | Lands on | Can do |
| --- | --- | --- | --- |
| Admin | 1 | Admin dashboard (`/admin.html`) | Everything a user can, plus: see every user, agent, call, summary and recording; add users, reset passwords, make admin or user, disable, delete; change app settings; read the activity log |
| User | 2 | The agent page (`/`) | Create and use their own agents, playbooks, calls and calendar; change their own password |

### Signing in

1. Enter username and password on the login page. Tick **Keep me signed in** to stay signed in for 30 days; otherwise the sign-in lasts 12 hours (both adjustable by the admin).
2. Admins go to the dashboard, users go to their agents.
3. Five wrong passwords for the same username from the same computer lock it for 5 minutes.
4. **Sign out** and **Change password** are in the user menu at the top right.

### Creating an account (self sign-up)

1. On the login page, open the **Create account** tab.
2. Enter full name, a username (suggested from the name; 3–32 letters, numbers, dot, dash or underscore), an optional email and a password of at least 6 characters, twice.
3. The new account is a **User**, is signed in straight away and already has one agent: a Personal Assistant.

The admin can turn self sign-up off in **Admin dashboard → App settings**; the tab then disappears. At most 5 accounts can be created per computer per hour.

### Accounts the admin creates

The admin picks name, username, role and a temporary password (a Generate button makes one and copies the details). The new user must choose their own password after first sign-in. When the admin resets a password or disables an account, that person is signed out everywhere at once.

### Safety rules built in

- Passwords are stored only as scrypt hashes, never as plain text.
- Sessions are a random token in a secure cookie; the database stores only its SHA-256 fingerprint.
- There is always at least one active admin: the last admin cannot be demoted, disabled or deleted, and admins cannot remove their own access.
- Deleting a user hides the account and frees the username, but keeps their agents, calls and recordings in the database so nothing is lost by mistake.

## Agents

An agent is one AI voice persona with its own job and setup; each user can create up to 20 (the admin sets the limit), and changing one agent never changes another agent or another user's agents.

### Agent types

The type decides how the agent behaves when no playbook is selected, and which ready-made playbooks it offers.

| Type | Default role | Ready-made playbooks |
| --- | --- | --- |
| Personal Assistant | Sharp, friendly personal assistant | Daily planner, Reminders & to-dos, Message drafting |
| Customer Support | Patient support agent | Order issue & returns, Technical troubleshooting, Complaint handling |
| Telecom Care | Mobile network care executive | Recharge & data packs, VAS / caller tune deactivation, Network complaint |
| Hospital & Healthcare | Calm hospital front desk and patient care | OPD appointment, Lab report status, Discharge follow-up |
| Banking & Finance | Trustworthy bank service officer | Card block & dispute, Loan enquiry, Account & KYC help |
| Sales | Friendly, non-pushy sales rep | Lead qualification, Demo booking, Upsell / renewal |
| Appointment Booking | Warm receptionist | Clinic booking, Salon booking, Reschedule / cancel |
| Payment Reminder | Polite billing reminder | Overdue bill reminder, EMI reminder |
| Feedback Survey | Upbeat survey caller | NPS survey, Post-service feedback |
| HR & Recruiting | Friendly recruiter | Candidate screening, Interview scheduling |
| Tutor & Coach | Encouraging tutor | Speaking practice, Mock interview |
| Wellness Companion | Supportive listener (not therapy) | Stress check-in, Sleep wind-down |
| Other / Custom | Helpful voice agent | Write your own |

Safety rules travel with the types: the hospital agent never diagnoses and sends chest pain or heavy bleeding to emergency; the banking agent never asks for a full card number, CVV, PIN, OTP or password.

### Creating and switching agents

1. At the top of the setup card, **My agents** shows one chip per agent; the active one is highlighted and ★ marks the default.
2. **＋ New agent** opens a dialog: pick the type, type a name (for example "Asha") and, optionally, what it's for ("Front desk for City Hospital, Pune"). That description is added to the agent's instructions, so it introduces itself correctly.
3. Click a chip to switch. The whole setup card reloads with that agent's settings. Switching is locked during a call.
4. **✎ About** edits the description, **☆ Default** makes the agent open first next time, **🗑** deletes it (its past calls stay in Call summaries).

The app remembers the last agent each user had open. A new account starts with one Personal Assistant agent.

### What belongs to an agent and what to the user

| Belongs to each agent | Shared by all of a user's agents |
| --- | --- |
| Name, language, voice | Saved playbooks (any agent can pick one) |
| LLM, speech-to-text and text-to-speech models | Call summaries list and totals (each call is labelled with its agent) |
| Selected playbook | Calendar events (each records which agent added it) |
| Calendar on/off, emergency on/off and numbers | Account and password |

## Agent setup card

The card on the left configures the selected agent, and every change saves itself within a second: there is no Save button.

A small pill in the card's header shows **Saving…**, then **✓ Saved** (or a warning if something failed). The next reply already uses the new setup.

### Parts of the card, top to bottom

1. **My agents**: switch, create, describe, set default or delete agents.
2. **AI name**: the name the agent uses for itself; also shown on the avatar.
3. **AI models**, in one row:
    - **LLM** (thinks and writes replies), default `gpt-5.5`.
    - **STT** (hears the caller), default `gpt-4o-transcribe`, or "Browser captions only" (free, less accurate).
    - **TTS** (speaks), default `gpt-4o-mini-tts` (supports emotions). The lists come live from your OpenAI account.
4. **Voice & language**: one of 16 languages and one of 10 voices (Marin, Cedar, Alloy, Coral, Shimmer, Sage, Ballad, Ash, Echo, Verse); ▶ plays a sample.
5. **Playbook**: the call script (next section).
6. **Calendar**: a switch. When on, the agent can add confirmed bookings during a call; the events list and .ics export sit inside this section.
7. **Emergency**: a switch plus emergency numbers (below).

### Playbooks

A playbook tells the agent its role, goal, steps, rules and what the summary should focus on.

- With no playbook selected, the agent runs in its type's default role (for example a hospital front desk).
- **＋ Add** → pick an agent type → pick a ready-made template or Custom → edit the fields → save.
- Click a playbook to use it; the "Default" row then hides. Click the selected playbook again to go back to default. 🗑 removes one.
- Playbooks belong to the user, so all of their agents can use them; each agent remembers its own selection.

### Emergency numbers

Turn Emergency on and an **＋ Add emergency number** form appears:

1. **Related to**: Ambulance, Police, Fire, Women helpline, Mental-health helpline, Child helpline, Disaster, All emergencies or Other.
2. **Number**: filled in for the chosen service (108, 100, 101, 1091, 14416, 1098, 1078, 112) and editable.
3. **Keywords**: tap suggestions or type your own (for example "chest pain", "bachao", "fire").

Adding the same service again updates it instead of duplicating it. Saved numbers sit in a collapsed "Saved numbers" list. During a call, a matching word shows a red 🚨 banner with a tap-to-call link and the agent leads its reply with that number. The agent also spots emergencies described in other words or languages.

## Making a call

A call is a loop: the agent listens until you pause, turns your speech into text, writes a short reply and speaks it, then listens again until you say goodbye.

![One call: 7 steps, 1 decision](images/call-flow.png)

The agent always speaks first, and the loop repeats for every turn; saying goodbye ends the call and saves it.

### Step by step

1. **Start call.** Press the green button. The app opens the microphone, starts recording (if ● is on), clears the previous conversation and starts the visualizer.
2. **Greeting.** The agent greets you first in its role and language, for example "Hello, City Hospital front desk, Asha speaking. How can I help you today?"
3. **Listening.** Your speech is recorded from the first word. Live captions appear in an italic bubble while you talk (Chrome and Edge), and a voice detector checks the mic level every 50 ms.
4. **Transcribing.** When you've been silent for 2 seconds, the recording is sent to OpenAI `gpt-4o-transcribe`, with a hint about the language and the agent's last sentence so names and numbers come out right. The bubble is replaced with the accurate text; a ✏️ mark shows if it corrected the captions. Pure noise is ignored.
5. **Thinking.** The text goes to the agent's LLM along with the recent conversation and its instructions (role, playbook, language, calendar and emergency rules). The reply streams back word by word.
6. **Speaking.** Each finished sentence is sent to text-to-speech in the emotion the agent chose for it, played in order, while the next one is prepared. Tap the avatar to interrupt.
7. **Goodbye.** When you clearly want to end ("bye", "that's all", "rakhta hoon" in any language), the agent says one short goodbye and hangs up by itself 0.8 seconds later. You can also press End call at any time.

### How the agent talks

- Short and human: one or two sentences, about 25 words, one question at a time.
- No bot phrases ("As an AI", "I'd be happy to assist") and no lists.
- If you correct something ("no, I meant Saturday"), the correction wins and the agent confirms it.
- If a word sounds misheard, the agent checks ("Sorry, did you say Friday?").
- It matches your language, including mixes like Hinglish, and your mood: soft when you're upset, upbeat when you're happy.

### What you see on each turn

Each of your messages gets chips for **intent** (what you want, in a few words), **mood**, **language** and **reply time**; each agent message shows the emotions used. The bar above the chat shows the latest intent, mood, language, the average reply time and the turn count. The ring around the avatar moves with your voice (green) and the agent's voice (the colour of its current emotion), with orbiting dots while it thinks.

The agent has 20 emotions: neutral, happy, excited, cheerful, calm, empathetic, sad, apologetic, encouraging, confident, serious, curious, surprised, thoughtful, concerned, reassuring, grateful, playful, urgent, proud.

### During a call, if enabled

- **Calendar**: once a booking is confirmed, the agent adds it, a 📅 chip appears on the reply and the event shows in the Calendar section.
- **Emergency**: a matching keyword shows a red banner with the number to call, and the agent tells you to call it first.

You can also type a message in the box under the chat instead of speaking.

## After the call: summaries, recordings and history

When a call ends, the app writes an AI summary, saves the call to the database with its transcript and statistics, uploads the recording if one was made, and shows it at the top of **Call summaries**.

### The call summary

The summary is written by the chat model in fixed sections, so every call reads the same way:

- **Summary**: two or three sentences on what happened.
- **Caller intent**: the main thing the caller wanted.
- **Caller mood**: at the start and at the end.
- **Key details**: the facts that matter, focused by the playbook (for example mobile number, plan, refund reference).
- **Action items** and **Outcome**.

The downloadable summary file adds the header (call ID, agent, start time, playbook, duration, turns, average reply, languages, mood path, tokens, emergencies, calendar events) and the full annotated transcript.

### Call summaries panel

Under the conversation, five tiles show your totals across all your agents: calls, talk time, tokens used, average reply time and recordings. Click any tile, or **Show calls**, to open the list.

Each row shows the agent's name, the playbook, date, duration, turns, mood path and whether there is a recording. Click a row to see the full summary, statistics, the recording player and the transcript with intent, mood, language and emotion chips; download the summary file or recording; or 🗑 delete the call (its summary and recording go with it). The list is paged, 5 calls per page by default.

### Recordings

The ● button records both sides of the call (your microphone and the agent's voice) as a .webm audio file. Recordings are stored as files on the server, one folder per user, and the database keeps their names and sizes. The upload limit is 100 MB per recording.

### Tokens and costs

Token totals count the chat replies and the summary. Text-to-speech audio is not included because OpenAI doesn't report it as tokens.

## Admin dashboard

Admins land on `/admin.html`, a single page that shows every user, every agent and every call, with tools to manage accounts and app settings. **Open my agent** at the top takes the admin to their own agents.

### Totals (top row)

Users (active and admins), agents (and per user), calls and turns, talk time, tokens, average reply time, playbooks and calendar events, and recordings, summed across all users.

### User cards

One card per user shows their role badge, a chip per agent (★ = default), their main LLM, a "signed up" chip for self sign-ups, calls, talk time, tokens, number of agents, and last call and sign-in times. A search box filters by name, username, email, agent name, type or model.

| Button | What it does |
| --- | --- |
| 👁 View agent & calls | Opens a side panel: every agent with its language, voice, models, playbook, calendar and emergency setup; playbooks; usage; the user's calls page by page. Click a call for its summary, transcript, recording player and downloads |
| 🔑 Reset password | Sets a new temporary password; the user is signed out and must change it |
| Make admin / Make user | Changes the role |
| ⛔ Disable / ✅ Enable | Blocks or restores sign-in; disabling signs the user out at once |
| 🗑 Delete | Hides the account (data is kept in the database) |
| ＋ Add user | Creates an account with a temporary password and a starter agent |

Admins can only read other users' data; they cannot change another user's agents or calls.

### App settings

| Setting | Default | Meaning |
| --- | --- | --- |
| Self sign-up | On | Shows Create account on the login page |
| Session length | 12 hours | How long a sign-in lasts without Keep me signed in |
| Keep me signed in | 30 days | How long a remembered sign-in lasts |
| Agents per user | 20 | Most agents one user can create |

Changes are saved to the database and apply immediately.

### Activity log

A paged list, newest first, of who did what and when: sign-in, sign-out, failed sign-in, sign-up, password change, users added, changed or deleted, agents created, edited or deleted, agent setup changes, playbooks added or removed, calls saved or deleted, calendar events, and app-setting changes. Above it, a line shows API requests, errors and average response time for the last 24 hours.

## Data and storage

All data and settings live in the MySQL database `ai-agent` (12 tables); only call recordings are kept as audio files on disk.

The tables are defined in `db/schema.sql` and created automatically on every start if missing. All times are stored in UTC.

### Tables

| Table | Holds | Main columns |
| --- | --- | --- |
| `roles` | The two roles | id (1 admin, 2 user), name, description |
| `users` | Accounts | id, username, name, email, role_id, password_hash, must_change_password, disabled, signup_source (setup, admin, self, import), last_login_at, deleted_at |
| `sessions` | Who is signed in | token_hash, user_id, ip, user_agent, expires_at |
| `app_config` | Shared settings, one JSON document per section | section (branding, agent, models, speechToText, conversation, history, calendar, emergency, auth), value |
| `agents` | Each agent's own setup | id, user_id, name, agent_type, description, language, voice, chat_model, tts_model, stt_engine, stt_model, playbook_id, calendar_enabled, emergency_enabled, is_default |
| `emergency_rules` | Emergency numbers per agent | agent_id, label, number, keywords (JSON), sort_order |
| `playbooks` | Users' saved call scripts | id, user_id, agent_type, name, role, goal, steps, rules, summary_focus |
| `calls` | Every finished call | id, user_id, agent_id, agent_name, started_at, ended_at, duration, turns, tokens, avg_response_ms, stats, transcript, recording file details |
| `call_summaries` | The AI summary and the full summary file text | call_id, summary, full_text |
| `calendar_events` | Events agents booked | id, user_id, agent_id, title, start_at, duration_min, notes |
| `activity_logs` | Who did what | user_id, username, action, target, details, ip, created_at |
| `api_logs` | Every API request | user_id, agent_id, method, path, status, duration_ms, created_at |

Deleting an agent keeps its calls and events (their agent link is cleared). Logs have no links to other tables, so history survives when users are deleted.

### Files on disk

| Location | Contents |
| --- | --- |
| `data/users/<userId>/recordings/` | Call recordings (.webm) |
| `backups/pre-mysql-2026-11-17/` | Full copy of the old file-based data before the move to MySQL |
| `backups/pre-login-2026-11-17/` | Older copy from before accounts were added |
| `.env` | OpenAI key and MySQL login (never committed) |
| `config.json` | Port, and the first-start defaults copied into `app_config` |

### Version history (git)

The code is in a git repository and every change is committed first, so any earlier version can be restored. Secrets, the `data/` folder and backups are excluded from git.

## How it works (architecture)

The browser pages talk only to one Node.js server; that server checks who is signed in, picks the right agent, calls OpenAI, and reads and writes MySQL and the recording files.

![Architecture: browser, Node server, OpenAI, MySQL, disk](images/architecture.png)

There is no separate Java or Spring Boot backend: Node connects to MySQL directly with the `mysql2` package, so there is one server to run. The front end is plain HTML, CSS and JavaScript with no build step.

### What happens on every request

1. The page sends the request with the session cookie and an `X-Agent-Id` header naming the selected agent.
2. The server checks the session (no session: sign-in page or a 401 error) and blocks data-changing requests from other websites.
3. Admin-only routes are refused for users. An admin may read another user's data with `?as=<userId>` (read-only).
4. The server loads the agent, but only if it belongs to that user; otherwise it uses their default agent.
5. Settings are layered: built-in defaults, then `app_config` from MySQL, then the agent's own setup.
6. The handler runs, then the request is written to `api_logs`; important actions also go to `activity_logs`.

### The reply format the agent uses

The LLM starts every reply with tags the page reads and removes before showing or speaking it, and puts an emotion before every sentence:

```
<intent:refund for caller tune charge><mood:angry><lang:Hinglish>[apologetic] Oh no, sorry about that. [curious] Which number is it?
<intent:end call><mood:satisfied><lang:English><hangup:yes>[grateful] Glad I could help, bye!
<intent:book dental cleaning><mood:neutral><lang:English><calendar:Dental cleaning|2026-11-21T18:30|30>[happy] Done, it's on your calendar.
```

| Tag | Used for |
| --- | --- |
| intent, mood, lang | The chips under each caller message and the bar above the chat |
| [emotion] | How text-to-speech says that sentence |
| hangup:yes | Ends the call after the goodbye |
| calendar:TITLE\|DATE TIME\|MINUTES | Adds a calendar event (only when Calendar is on) |

### Main API routes

| Route | Purpose |
| --- | --- |
| POST /api/login, /api/logout, /api/signup | Sign in, sign out, create account |
| GET /api/me, POST /api/me/password | Who is signed in, change password |
| GET, POST, PATCH, DELETE /api/agents | List, create, edit, delete agents |
| GET /api/config, POST /api/settings | Read and auto-save the selected agent's setup |
| POST /api/chat | Streamed reply (server-sent events) |
| POST /api/transcribe, /api/tts | Speech to text, text to speech |
| POST /api/summary | Write the call summary |
| GET, POST, DELETE /api/calls | Call list, save, details, delete; recording upload and download; summary file |
| GET, POST, DELETE /api/playbooks, /api/calendar | Playbooks; calendar events and .ics export |
| GET /api/models | Models available on the OpenAI account |
| /api/admin/overview, users, logs, config | Admin dashboard data and actions |

## Settings, security and troubleshooting

Shared settings live in the `app_config` table; each agent's own choices (name, language, voice, models, playbook, calendar, emergency) live in `agents` and override them.

### Settings reference (`app_config`)

| Setting | Default | Meaning |
| --- | --- | --- |
| branding.appName / tagline / footer | TelemuneSmartAi · … · Powered by Telemune © 2027 · Designed by DJ | Header title, subtitle, footer |
| branding.theme.primary / secondary / tertiary | #7c3aed / #ec4899 / #06b6d4 | Brand colours used in every gradient |
| agent.defaultName / defaultLanguage / defaultVoice | Riya / en-US / cedar | Starting name, language and voice for new agents |
| agent.maxReplyWords | 25 | Target length of a spoken reply |
| agent.maxAgentsPerUser | 20 | Agent limit per user |
| models.chat / tts / reasoningEffort | gpt-5.5 / gpt-4o-mini-tts / low | Default models for new agents |
| models.maxReplyTokens / maxSummaryTokens | 1024 / 2048 | Output limits |
| speechToText.engine / model | openai / gpt-4o-transcribe | How the caller is heard |
| speechToText.vadThreshold | 0.015 | Mic loudness counted as speech; raise in noisy rooms |
| speechToText.minSpeechMs / maxUtteranceSeconds | 250 / 60 | Shortest speech that counts / longest single utterance |
| conversation.responseDelayMs | 2000 | Silence before the agent replies |
| conversation.hangupDelayMs | 800 | Pause after the goodbye before disconnecting |
| conversation.historyTurnsSentToModel | 30 | Recent messages sent to the model |
| history.pageSize / maxRecordingMB | 5 / 100 | Calls per page / recording size limit |
| calendar.defaultDurationMin | 30 | Event length when none is given |
| auth.allowSignup / sessionHours / rememberDays | true / 12 / 30 | Sign-up and sign-in length |

The four auth and agent-limit settings are editable in the admin dashboard; others are changed in the database, for example `UPDATE app_config SET value = JSON_SET(value, '$.responseDelayMs', 1500) WHERE section = 'conversation';`. Optional environment overrides: `PORT`, `OPENAI_MODEL`, `OPENAI_TTS_MODEL`, `OPENAI_REASONING_EFFORT`.

### Security notes

- Passwords are hashed with scrypt; session tokens are stored only as SHA-256 fingerprints.
- Requests that change data from another website are rejected.
- Users can only reach their own rows: every database query filters by the signed-in user, and an agent id sent by the page is accepted only if it belongs to that user.
- The app currently runs over plain http on localhost. Before others use it over a network, put it behind https so passwords are not sent in the clear.
- Change the default admin password (admin@123) after first sign-in.

### Troubleshooting

| Symptom | Fix |
| --- | --- |
| Server stops with "Can't connect to MySQL" | Start MySQL and check the `MYSQL_*` values in `.env` |
| Orange banner: server is older than the page | Restart with `./runScript.sh` |
| "Server is missing a valid OPENAI_API_KEY" | Add the key to `.env` and restart |
| "Rate limited or out of credit" | Check OpenAI billing |
| Microphone doesn't work | Use Chrome or Edge at http://localhost (the Claude in-app browser blocks the mic) |
| Agent cuts in too early or waits too long | Change `conversation.responseDelayMs` |
| Background noise triggers replies | Raise `speechToText.vadThreshold` |
| Create account tab is missing | Self sign-up is off: Admin dashboard → App settings |
| Account locked | Wait 5 minutes after 5 wrong passwords, or ask an admin to reset it |
| Can't switch agents | Switching is locked during a call; end the call first |
