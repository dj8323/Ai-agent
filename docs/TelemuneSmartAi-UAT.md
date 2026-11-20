# TelemuneSmartAi — User Acceptance Testing (UAT)

**Version:** 1.0 · **First run:** 20 Nov 2026 · **Owner:** DJ · **Applies to:** voice_ai_backend + voice_ai_web (`main` from commit `daaf020`)

This document is the UAT plan, the test cases and the results for TelemuneSmartAi. Keep it next to the code: run the
automated part before every release, walk through the screen checks, fill in the sign-off, and add new cases here when a
feature is added.


## 1. Summary of the first run (20 Nov 2026)

| Part | Cases | Passed | Failed | Skipped | Notes |
|---|---|---|---|---|---|
| Automated (API, `uat/run-uat.mjs`) | 61 | 57 | 0 | 4 | Skipped on purpose: 2 SuperAdmin cases (need its sign-in) and 2 AI cases (cost OpenAI tokens) |
| Screen checks (browser) | 30 | 30 | 0 | 0 | Desktop 1280 px, phone 375 px, light and dark |
| **Total** | **91** | **87** | **0** | **4** | No blocking issues. 1 known layout issue on phones (section 7) |

**Verdict:** ready for use. The 4 skipped cases should be run once by the SuperAdmin before a production release (section 3.3).


## 2. Scope

**In scope:** sign-in and sign-up, roles (SuperAdmin, admin, user) and their limits, agents and Agent studio (profile, voice &
AI, availability, tools), playbooks, calendar, emergency contacts, caller messages, conversations on every channel and call
summaries (with recordings), 📊 Insights, privacy between accounts, the admin dashboard (users, access, agent types,
settings, site theme, sign-ins, activity log), the SuperAdmin's server settings, the web app (pages, redirects, API proxy),
guides (tours), site themes, light/dark mode and phone layout.

**Not run automatically (they cost money or reach real people):** a live web call with a microphone, AI replies, speech
providers (OpenAI, AWS, ElevenLabs, Cartesia), WhatsApp and email sending, emergency alerts, backend restart. They are in
the manual list (section 6) and need the owner's OK before they are run, because they send real messages or use paid APIs.


## 3. How to run

### 3.1 Environment

- Backend running (`cd voice_ai_backend && ./run.sh`, port 8324) and web app running (`cd voice_ai_web && ./run.sh`, port 8323), or both with `./runScript.sh`.
- On the same server: Node 22+, the `mysql` command-line client, and `voice_ai_backend/.env` (MySQL settings). The script reads `.env` locally and never prints it.
- Browser for the screen checks: Chrome or Edge.

### 3.2 Tester accounts and agents

The script makes its own testers on every run and deletes them at the end, so nothing is left behind and real users are
never touched. Names end in the run id, e.g. `uat.user.11201113b338`.

| Tester | Role | What it is used for |
|---|---|---|
| `uat.user.<run>` | User (self sign-up) | Owns 3 agents: **UAT Brown** (Call Assistant for DJ), **UAT Riya** (Support), **UAT Max** (Appointment, changed to Support in AGT-08). Has playbooks, a meeting, emergency contacts, a caller message and 6 sample conversations on 3 channels over 40 days |
| `uat.admin.<run>` | Admin | Admin dashboard, creating users, access limits, site theme |
| `uat.made.<run>` | User created by the admin | Checks that a user never gets more than its admin |
| `uat.other.<run>` | User | Privacy: can't see the first user's data |
| `uat.lock.<run>` | User | Sign-in lock after 5 wrong passwords |

### 3.3 Commands

```bash
node uat/run-uat.mjs                                  # all free tests; deletes the testers at the end
node uat/run-uat.mjs --keep                           # keep the testers for the screen checks (sign-ins printed once)
UAT_PASSWORD='Your-Test-Pass-1!' node uat/run-uat.mjs --keep   # choose the testers' password yourself
node uat/run-uat.mjs --cleanup <run>                  # remove the testers a --keep run left (or: --cleanup all)
UAT_SUPER_USER=superadmin UAT_SUPER_PASS='…' node uat/run-uat.mjs   # also the SuperAdmin cases (SUP-01, SUP-02)
node uat/run-uat.mjs --ai                             # also AI-01/AI-02 (one greeting + one short speech, a few tokens)
UAT_BACKEND=http://10.0.0.5:8324 UAT_WEB=http://10.0.0.5:8323 node uat/run-uat.mjs   # another server
```

- Results print on screen and are saved to `uat/reports/UAT-<run>.md` (not committed).
- Exit code: 0 = all passed, 1 = something failed, 2 = could not run (backend or MySQL not reachable).
- The one shared setting it changes (the site theme, ADM-11) is put back at once.
- After `--keep`, a user created by an admin is also asked to change its password on first sign-in; that is normal.


## 4. Automated test cases and results

Result of run `11201113b338` on 20 Nov 2026.

| ID | Area | Test | Result 20 Nov 2026 | Notes |
|---|---|---|---|---|
| AUTH-01 | Public pages and sign-in | Health check answers without signing in | ✅ PASS |  |
| AUTH-02 | Public pages and sign-in | Sign-in options are public and include the site theme | ✅ PASS | theme violet, sign-up open |
| AUTH-03 | Public pages and sign-in | Signed-out API calls get 401 | ✅ PASS |  |
| AUTH-04 | Public pages and sign-in | Self sign-up creates a user (role 2) and signs in | ✅ PASS |  |
| AUTH-05 | Public pages and sign-in | New accounts start with no agents | ✅ PASS |  |
| AUTH-06 | Public pages and sign-in | Wrong password is refused | ✅ PASS |  |
| AUTH-07 | Public pages and sign-in | Correct password signs in | ✅ PASS |  |
| AUTH-08 | Public pages and sign-in | 5 wrong passwords lock the account for a while | ✅ PASS | Too many attempts. Wait 5 minutes and try again. |
| AUTH-09 | Public pages and sign-in | A change from another site (Origin) is blocked | ✅ PASS |  |
| AGT-01 | Agents and Agent studio | Agent types and templates are listed | ✅ PASS | 15 types |
| AGT-02 | Agents and Agent studio | Create a Call Assistant agent that works for someone | ✅ PASS |  |
| AGT-03 | Agents and Agent studio | Create a Support agent and an Appointment agent | ✅ PASS |  |
| AGT-04 | Agents and Agent studio | The agent list has all three | ✅ PASS |  |
| AGT-05 | Agents and Agent studio | Make an agent the default | ✅ PASS |  |
| AGT-06 | Agents and Agent studio | Auto-save the profile, availability and calendar (POST /api/settings) | ✅ PASS |  |
| AGT-07 | Agents and Agent studio | A user can't pick AI models (they go back to the defaults) | ✅ PASS |  |
| AGT-08 | Agents and Agent studio | Changing the agent type resets its profile | ✅ PASS |  |
| AGT-09 | Agents and Agent studio | The page config has voices, languages, providers and country codes | ✅ PASS |  |
| TOOL-01 | Tools: playbooks, calendar, emergency, messages | Add, list and delete a playbook | ✅ PASS |  |
| TOOL-02 | Tools: playbooks, calendar, emergency, messages | Put the playbook on an agent | ✅ PASS |  |
| TOOL-03 | Tools: playbooks, calendar, emergency, messages | Book a calendar event (calendar on) and export it | ✅ PASS |  |
| TOOL-04 | Tools: playbooks, calendar, emergency, messages | Calendar off refuses new events | ✅ PASS |  |
| TOOL-05 | Tools: playbooks, calendar, emergency, messages | Emergency contacts save with keywords | ✅ PASS |  |
| TOOL-06 | Tools: playbooks, calendar, emergency, messages | A caller's message: add, list, mark done, delete | ✅ PASS |  |
| CALL-01 | Conversations and call summaries (every channel) | Save conversations on every channel (call, live chat, voice chat) | ✅ PASS | 6 saved |
| CALL-02 | Conversations and call summaries (every channel) | Call summaries filter by channel | ✅ PASS |  |
| CALL-03 | Conversations and call summaries (every channel) | Totals per channel add up | ✅ PASS |  |
| CALL-04 | Conversations and call summaries (every channel) | Open one conversation with its summary and transcript | ✅ PASS |  |
| CALL-05 | Conversations and call summaries (every channel) | Store and play back a recording | ✅ PASS |  |
| CALL-06 | Conversations and call summaries (every channel) | Delete a conversation | ✅ PASS |  |
| DASH-01 | 📊 Insights (dashboard) | 30 days: totals, previous period, channels, heat, intents | ✅ PASS | top intent "billing question" ×2 |
| DASH-02 | 📊 Insights (dashboard) | 7 days and 90 days change the numbers | ✅ PASS |  |
| DASH-03 | 📊 Insights (dashboard) | One agent only | ✅ PASS |  |
| DASH-04 | 📊 Insights (dashboard) | Someone else's agent id is refused | ✅ PASS |  |
| PRIV-01 | Privacy between accounts | Another user can't open my conversation | ✅ PASS |  |
| PRIV-02 | Privacy between accounts | Another user's X-Agent-Id doesn't give my agent | ✅ PASS |  |
| PRIV-03 | Privacy between accounts | A user can't use the admin API | ✅ PASS |  |
| ADM-01 | Admin dashboard | Make a tester admin (role 1) and sign in | ✅ PASS |  |
| ADM-02 | Admin dashboard | Overview lists the users, never the SuperAdmin | ✅ PASS | 8 users seen |
| ADM-03 | Admin dashboard | Open one user's details (👁 View) | ✅ PASS |  |
| ADM-04 | Admin dashboard | Read a user's data read-only (?as=) | ✅ PASS |  |
| ADM-05 | Admin dashboard | Limit the admin to 2 agent types, then it creates a user | ✅ PASS |  |
| ADM-06 | Admin dashboard | The new user never gets more types than the admin | ✅ PASS | secretary, support |
| ADM-07 | Admin dashboard | An admin can't create admins or change roles | ✅ PASS |  |
| ADM-08 | Admin dashboard | Switch 📊 Insights off for a user: the server refuses it | ✅ PASS |  |
| ADM-09 | Admin dashboard | Activity log: user activity, sign-ins, admin changes | ✅ PASS |  |
| ADM-10 | Admin dashboard | The SuperAdmin can't be found by an admin | ✅ PASS |  |
| ADM-11 | Admin dashboard | Site theme: change it, the public options follow, put it back | ✅ PASS | violet → rose → violet |
| ADM-12 | Admin dashboard | Limit the admin's sections: others are refused | ✅ PASS |  |
| ADM-13 | Admin dashboard | Delete a user: it can't sign in any more | ✅ PASS |  |
| SUP-01 | SuperAdmin (only with UAT_SUPER_USER / UAT_SUPER_PASS) | Server settings show, with secrets masked | ⏭ SKIP | no SuperAdmin sign-in given |
| SUP-02 | SuperAdmin (only with UAT_SUPER_USER / UAT_SUPER_PASS) | The SuperAdmin sees the admins | ⏭ SKIP | no SuperAdmin sign-in given |
| WEB-01 | Web app (pages, files, proxy) | Signed out, the main page goes to the login page | ✅ PASS |  |
| WEB-02 | Web app (pages, files, proxy) | Login page and the shared scripts load | ✅ PASS |  |
| WEB-03 | Web app (pages, files, proxy) | The API works through the web app (same origin) | ✅ PASS |  |
| WEB-04 | Web app (pages, files, proxy) | A user is sent away from the admin page | ✅ PASS |  |
| WEB-05 | Web app (pages, files, proxy) | An admin opens the admin page | ✅ PASS |  |
| AI-01 | AI (only with --ai; costs a few OpenAI tokens) | Greeting text for an agent | ⏭ SKIP | run with --ai |
| AI-02 | AI (only with --ai; costs a few OpenAI tokens) | Text to speech returns audio | ⏭ SKIP | run with --ai |
| ACC-01 | Account | Change my password: the old one stops working | ✅ PASS |  |
| ACC-02 | Account | Sign out ends the session | ✅ PASS |  |


## 5. Screen checks (browser)

Run after `node uat/run-uat.mjs --keep`, signed in as the tester user and then the tester admin. Result of 20 Nov 2026.

| ID | Screen | Steps | Expected | Result |
|---|---|---|---|---|
| UI-01 | Login | Open `/login.html` | Sign in and Create account tabs; name, username, email, password fields | ✅ PASS |
| UI-02 | Start page | Sign in as a user with agents | Lands on **📊 Insights** (no hash in the address) | ✅ PASS |
| UI-03 | Insights | Look at the page | Slim greeting bar with agent picker and 7/30/90 days in one row; 6 tiles; daily stacked chart; channel mix; reply speed; busiest-times grid; intents; endings; agents table; meetings; messages; recent conversations | ✅ PASS |
| UI-04 | Insights | Hover a day, a heat square, the reply line | Tooltips with the numbers | ✅ PASS |
| UI-05 | Insights | Switch 7 / 30 / 90 days and pick one agent | Every part changes; headline names the agent | ✅ PASS |
| UI-06 | Insights | Click a recent conversation | Its summary opens | ✅ PASS |
| UI-07 | Menu | Read the top menu | 📊 Insights · 💬 Conversations · 🤖 Agent studio · 🧭 Guides | ✅ PASS |
| UI-08 | Conversations | Open before any call | The looping chat shows (hello, reply, typing dots) with "Start a call or a chat…" | ✅ PASS |
| UI-09 | Conversations | Start a chat or add the first message, then Clear | The looping chat disappears at the first message and comes back after Clear | ✅ PASS |
| UI-10 | Conversations | Agent card | AI models as **STT / TTS / LLM** tags with the provider; Tools chips 📅 Calendar, 🚨 Emergency, 📘 Playbook | ✅ PASS |
| UI-11 | Conversations | Click 🚨 Emergency (or 📘 Playbook) | Agent studio opens at Tools → that section, which glows; the cursor is on its first control | ✅ PASS |
| UI-12 | Conversations | Pick a playbook in Agent studio | The 📘 chip shows its name; with none it shows "＋ Add a playbook" | ✅ PASS |
| UI-13 | Conversations | Click Web call, Live chat, Voice chat, WhatsApp | Each shows its own panel; WhatsApp has country code + number on row 1, message + send on row 2 | ✅ PASS |
| UI-14 | Call summaries | Filter chips and a row | Chips All / Calls / Live chat / Voice chat / WhatsApp with counts; a row opens the record | ✅ PASS |
| UI-15 | Agent studio | Open each tab | Profile, Voice & AI, Availability, Tools all open | ✅ PASS |
| UI-16 | Agent studio | Close with ✕ | Goes back to the page you came from | ✅ PASS |
| UI-17 | New agent | ＋ New agent | Wizard steps Profile → Voice & AI → Availability → Tools → Review | ✅ PASS |
| UI-18 | Guides | Open 🧭 Guides, start "Your insights" | 13 tours listed; the tour starts at step 1 of 7 | ✅ PASS |
| UI-19 | Theme | Light/dark button | Every page follows; charts stay readable | ✅ PASS |
| UI-20 | Phone | Width 375 px | Cards stack in one column; no broken screens (see known issue K-1) | ✅ PASS |
| UI-21 | Admin | Sign in as admin | Lands on the admin dashboard | ✅ PASS |
| UI-22 | Admin | Menu | Overview · Users · Agents · 📈 Usage · 🧩 Agent types · Settings · Sign-ins · 📜 Activity log | ✅ PASS |
| UI-23 | Admin | Click a KPI tile | A user-by-user table opens | ✅ PASS |
| UI-24 | Admin | Users list | Testers listed; the SuperAdmin never appears | ✅ PASS |
| UI-25 | Admin | ✏️ Edit a user | Edit window with details and access (sections, features, agent and playbook types, 📊 Insights page) | ✅ PASS |
| UI-26 | Admin | Settings → 🎨 Theme | 8 theme cards; the current one marked; Moving background switch | ✅ PASS |
| UI-27 | Admin | Activity log | 👤 User activity first; filters Admin & settings, Sign-ins, All, by user | ✅ PASS |
| UI-28 | Admin | 📈 Usage | "Usage by user" table | ✅ PASS |
| UI-29 | Admin | Dark mode on a phone | Readable; menu wraps | ✅ PASS |
| UI-30 | All | Browser console | No errors on any page | ✅ PASS |


## 6. Manual cases that need the owner's OK

These use paid services or reach real people, so they are run by hand, on purpose, with the owner's agreement.

| ID | Case | Steps | Expected |
|---|---|---|---|
| MAN-01 | Live web call | Chrome, allow the microphone, 💬 Conversations → Start call, speak two sentences, say goodbye | Greeting plays at once; replies in about 3–4 s; the face lip-syncs; hang-up after goodbye; summary at the top; record saved with recording |
| MAN-02 | Barge-in | Talk while the agent speaks | Agent stops; ✋ chip; your words are used |
| MAN-03 | Silence | Say nothing for 8 s, twice | Agent checks in, then says goodbye and ends |
| MAN-04 | Live chat / voice chat | Type, or hold to talk | Replies; End & save writes a summary |
| MAN-05 | Speech providers | Switch STT/TTS to AWS, ElevenLabs, Cartesia (if keys are set) and press ▶ Play | Voice plays; on an error it falls back to OpenAI |
| MAN-06 | WhatsApp send | Send a test message to the owner's own number | Accepted by the gateway; record in Call summaries |
| MAN-07 | Summary by WhatsApp / email | Switch on in Tools, make a short call | Summary arrives on the owner's phone / mailbox |
| MAN-08 | Emergency | Say a keyword during a call | Banner with the contact; WhatsApp/email alert once |
| MAN-09 | SuperAdmin restart | 🔄 Restart backend | Back in 10–20 s; the page waits and reloads |
| MAN-10 | HTTPS from another computer | Open `https://<server-ip>:8443` | Certificate warning once, then the mic works |


## 7. Known issues and notes

| ID | Severity | Issue | Status |
|---|---|---|---|
| K-1 | Low | On phones (375 px), the pages lay out about 440–460 px wide because the header (logo, menu, user button) doesn't shrink; the browser zooms out a little. Seen on Conversations and the admin dashboard, before and after these changes | Open — fix the header wrap |
| N-1 | Info | In the API's "last 24 h" line on the admin page, errors include the 4xx answers the UAT causes on purpose (wrong password, refused access) | Expected |
| N-2 | Info | A conversation saved without `stats.avgResponse` text shows "avg reply —" in its record; the app always sends it, only hand-made records lack it | Expected |


## 8. Adding a test case

1. Add a `test("AREA-NN", "What a person checks", async () => { … })` in `uat/run-uat.mjs`, in the right `section(…)`. Use the tester sessions (`S.user`, `S.admin`, `S.other`, `S.made`) and `ok`/`eq`; `skip("why")` when it can't run.
2. Anything the test creates must belong to a tester, so the clean-up removes it. Never change real users' data; put shared settings back at the end of the test (see ADM-11).
3. Add the case to section 4 or 5 of this document, run it, and fill in the result.


## 9. Sign-off

| Role | Name | Date | Result | Signature |
|---|---|---|---|---|
| Tested by | | | | |
| Product owner | | | | |
| Approved for release | | | | |
