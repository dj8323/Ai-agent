# TelemuneSmartAi — Troubleshooting guide

How to find out what went wrong: which log to open, how to follow one request from the browser to MySQL and OpenAI,
what each table holds, and ready-to-run SQL queries.

## 1. Log files

voice_ai_backend writes its logs to `voice_ai_backend/logs/` (`LOG_DIR` in `.env` moves them). The web app has its own:
`voice_ai_web/logs/web.log` (one line per request with the same `[request id]`) and `voice_ai_web/logs/error.log`. Old files are rotated daily (or at the
size limit) into `logs/archive/` as `.gz`.

Only two files:

| File | What is in it | Level | Kept |
|---|---|---|---|
| `logs/backend.log` | **Everything**: start-up, every API request (method, path, status, time), sign-ins, user actions, every OpenAI call with timings and tokens; at DEBUG also the incoming request (+ browser), caller's words, agent's reply, greeting text, OpenAI request ids, cache hits and every SQL statement (time, rows, SQL, arguments with password/token hashes shown as `***`, BEGIN/COMMIT/ROLLBACK) | DEBUG and up | 14 days |
| `logs/error.log` | **Problems only** (also in backend.log): failed sign-ins, 4xx/5xx answers, OpenAI errors, SQL errors, slow SQL, stack traces, and anything the JVM prints itself (e.g. a crash before logging starts). **Look here first.** | WARN, ERROR | 60 days |

Times are **UTC** (marked `Z`), the same as every DATETIME in MySQL, so a log line and a table row can be matched
directly. India time = UTC + 5:30.

### Line format

```
2026-11-18 13:51:33.642Z INFO  [08c2f1f2] [qa.logs] [0e1a116c] c.t.s.a.OpenAiClient - OpenAI chat gpt-4.1-mini finished: first token 1845 ms, total 2033 ms, tokens 1602
└ time (UTC)             level  request id  user      agent id   class               message
```

- **Request id** (`[08c2f1f2]`): a new one for every API request. The browser gets it in the `X-Request-Id` response
  header (DevTools → Network → the request → Headers), and it is stored in `api_logs.request_id` and
  `activity_logs.request_id`. One id finds the request everywhere.
- **User**: the signed-in username (`-` before sign-in). **Agent id**: the agent the request was for (`agents.id`).

### Log levels

| Setting | Where | Values | Effect |
|---|---|---|---|
| `LOG_LEVEL` | `.env`, then restart | `DEBUG` (default), `INFO` | `INFO` drops the detail lines (caller's words, replies…) from `backend.log` |
| `SQL_LOG` | `.env`, then restart | `DEBUG` (default), `INFO` | `INFO` drops the SQL lines from `backend.log` (slow/failed SQL are still logged, also in `error.log`) |
| Live change | `PUT /api/admin/log-level` (admin) | `{"logger":"com.telemune" or "SQL","level":"DEBUG/INFO/WARN/ERROR"}` | Changes at once, until the next restart. `GET /api/admin/log-level` shows the current levels |

Thresholds built in: SQL slower than **500 ms** → WARN "Slow SQL"; API requests slower than **3 s** → WARN "(slow)"
(chat, speech and transcription are left out, they are long by nature).

## 2. Following one request

```bash
# 1. find the request (e.g. the last failed one)
grep "← " logs/backend.log | grep -E " (4|5)[0-9]{2} in " | tail -5

# 2. everything that happened in it (app lines + SQL)
grep "\[08c2f1f2\]" logs/backend.log

# 3. everything one user did today
grep "\[qa.logs\]" logs/backend.log

# 4. live view while you reproduce the problem
tail -f logs/backend.log

# 5. the same request in the web app's log (run in voice_ai_web/)
grep "\[08c2f1f2\]" logs/web.log
```

Example: one chat turn in `backend.log`

```
INFO  [08c2f1f2] [qa.logs] [0e1a116c] VoiceController - Chat turn: agent "Logbot", lang en-IN, playbook -, 1 turns, prompt 6354 chars
DEBUG [08c2f1f2] ...                  VoiceController - Caller said: "Hi, is DJ there?"
DEBUG [08c2f1f2] ...                  OpenAiClient   - OpenAI chat stream: model gpt-4.1-mini, 2 messages, max tokens 1024, effort -
DEBUG [08c2f1f2] ...                  OpenAiClient   - OpenAI POST /v1/chat/completions → HTTP 200 (headers in 1837 ms, request id req_963a…)
INFO  [08c2f1f2] ...                  OpenAiClient   - OpenAI chat gpt-4.1-mini finished: first token 1845 ms, total 2033 ms, tokens 1602
DEBUG [08c2f1f2] ...                  VoiceController - Agent replied: "<intent:check availability>… Hello, DJ isn't available…"
INFO  [08c2f1f2] ...                  ApiFilter      - ← POST /api/chat 200 in 2065 ms
```

The OpenAI `request id` (`req_…`) is what OpenAI support asks for.

## 3. Common problems — where to look

| Symptom | Look for | Likely cause / fix |
|---|---|---|
| Backend won't start | `logs/error.log` (last 30 lines) | MySQL not running, wrong `MYSQL_*` in `.env`, port 8324 in use |
| "Server is missing a valid OPENAI_API_KEY" | `error.log`: `OpenAI answered HTTP 401` | Key missing/wrong in `.env`; restart |
| "Rate limited or out of credit" | `error.log`: `OpenAI answered HTTP 429` | OpenAI billing / limits |
| "A model … isn't available" | `error.log`: `OpenAI answered HTTP 404` + message | Model name in Admin → App settings or the agent's Voice & AI |
| Agent slow to answer | `backend.log`: `OpenAI chat … first token N ms`, `OpenAI transcribe … in N ms` | First token > 2.5 s = model/OpenAI; transcription slow = long recordings |
| Agent says nothing / no voice | `backend.log`: `OpenAI speech …`; `error.log`: `tts stream failed` | TTS model / voice; check the browser console too |
| Caller's words wrong | `backend.log`: `Transcript: "…"` and `Caller said: "…"` | Mic, language setting, `speechToText.model` |
| User can't sign in | `error.log`: `Sign-in FAILED: <user> from <ip> - <reason>` | reason = unknown user / wrong password / locked / disabled. Queries in §5 |
| "Please sign in." on every click | `backend.log`: `Refused 401: Please sign in.` | Session expired or deleted (`sessions` table) |
| "Cross-site request blocked." | `backend.log`: `Refused 403` | Page opened from another host/port than voice_ai_web |
| "Create an agent first." | `backend.log`: `API answered 400: Create an agent first.` | User has no agents (normal for new accounts) |
| Something saved wrong | `backend.log` SQL lines for that request id: the exact UPDATE/INSERT and its values | |
| Server error 500 | `error.log`: `Request failed with an unexpected error` + Java stack trace | Send the stack trace to the developer |
| Database error | `error.log`: `SQL failed (N ms): <sql> | args=[…] | <MySQL message>` | Missing column (restart runs migrations), data too long, duplicate key |
| Recording missing | `backend.log`: `Recording for call <id>: N KB … saved / not saved` | Size over `history.maxRecordingMB`; file in `data/users/<userId>/recordings/` |

## 4. Tables (MySQL database `ai-agent`)

All times are UTC. Ids are 8-character hex strings unless noted.

| Table | Holds | Key columns |
|---|---|---|
| `roles` | 1 = admin, 2 = user | id, name |
| `users` | Accounts | id, username, name, email, role_id, password_hash (scrypt), disabled, must_change_password, signup_source, created_at, last_login_at, deleted_at (soft delete) |
| `sessions` | Signed-in browsers | token_hash (SHA-256 of the cookie), user_id, ip, user_agent, created_at, expires_at |
| `login_attempts` | Every sign-in try | username, user_id, ip, user_agent, success (0/1), reason, created_at |
| `app_config` | Shared settings, one JSON per section (branding, agent, models, speechToText, conversation, history, calendar, emergency, auth) | section, value, updated_at, updated_by |
| `agent_types` | Agent kinds (personal, secretary, support, hospital, realestate, …) | type_key, name, role, greeting, needs_owner, default_calendar, active |
| `agent_templates` | Ready-made scripts per type | id, type_key, name, role, greeting, goal, steps, rules, summary_focus, is_default, active |
| `agents` | Each user's agents | id, user_id, name, agent_type, template_id, owner_name, organization, owner_availability, availability_plan (JSON), greeting, language, voice, chat_model, tts_model, stt_model, speech_speed, playbook_id, calendar_enabled, emergency_enabled, meeting_minutes, is_default |
| `emergency_rules` | Emergency contacts per agent | agent_id, label, contact_type (phone/email), number, keywords (JSON) |
| `playbooks` | Users' own scripts | id, user_id, agent_type, name, role, goal, steps, rules |
| `calls` | Call history | id, user_id, agent_id, agent_name, started_at, ended_at, duration_seconds, ended_by, language, voice, turns, tokens_*, avg_response_ms, stats (JSON), transcript (JSON), recording_file, recording_bytes |
| `call_summaries` | AI summary of a call | call_id, summary, full_text |
| `calendar_events` | Meetings booked by agents | id, user_id, agent_id, title, start_at, duration_min, notes, source |
| `messages` | Messages callers left | id, user_id, agent_id, caller_name, caller_number, urgency, message, status (new/done) |
| `activity_logs` | Who did what (sign-in, agent create/update/delete, settings, calls, admin actions) | **request_id**, user_id, username, action, target, details (JSON), ip, created_at |
| `api_logs` | Every API request | **request_id**, user_id, agent_id, method, path, status, duration_ms, ip, created_at |

Activity `action` values: `auth.login`, `auth.login_failed`, `auth.logout`, `auth.signup`, `auth.password_change`,
`agent.create`, `agent.update`, `agent.delete`, `agent.settings`, `calendar.add`, `calendar.delete`, `call.save`,
`call.delete`, `message.add`, `message.delete`, `playbook.add`, `playbook.delete`, `user.create`, `user.update`,
`user.delete`, `config.update`, `type.create`, `type.update`, `template.create`, `template.update`,
`template.delete`, `log.level`.

## 5. Troubleshooting queries

Connect: `mysql -h <MYSQL_HOST> -u <MYSQL_USER> -p ai-agent` (values from `.env`).

### One request / one user

```sql
-- Everything about one request id (from a log line or the X-Request-Id header)
SELECT * FROM api_logs      WHERE request_id = '08c2f1f2';
SELECT * FROM activity_logs WHERE request_id = '08c2f1f2';

-- A user by username, with their agents
SELECT id, username, name, email, role_id, disabled, created_at, last_login_at, deleted_at FROM users WHERE username = 'dj8323';
SELECT id, name, agent_type, template_id, owner_name, language, voice, chat_model, is_default, updated_at
  FROM agents WHERE user_id = (SELECT id FROM users WHERE username = 'dj8323');

-- What a user did, newest first
SELECT created_at, action, target, details, ip, request_id FROM activity_logs
 WHERE username = 'dj8323' ORDER BY id DESC LIMIT 50;
```

### Sign-in problems

```sql
-- Last sign-in attempts of a user (why it failed)
SELECT created_at, ip, success, reason, user_agent FROM login_attempts
 WHERE username = 'dj8323' ORDER BY id DESC LIMIT 20;

-- Is the user locked? (5+ failures in the last 5 minutes since the last success)
SELECT username, ip, COUNT(*) AS failures FROM login_attempts
 WHERE success = 0 AND created_at > UTC_TIMESTAMP() - INTERVAL 5 MINUTE
 GROUP BY username, ip HAVING failures >= 5;

-- Active sessions of a user
SELECT created_at, expires_at, ip, user_agent FROM sessions
 WHERE user_id = (SELECT id FROM users WHERE username = 'dj8323') AND expires_at > UTC_TIMESTAMP();

-- Sign a user out everywhere
DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = 'dj8323');

-- Re-enable a disabled account
UPDATE users SET disabled = 0 WHERE username = 'dj8323';
```

### API errors and speed

```sql
-- Errors in the last hour
SELECT created_at, request_id, method, path, status, duration_ms, user_id FROM api_logs
 WHERE status >= 400 AND created_at > UTC_TIMESTAMP() - INTERVAL 1 HOUR ORDER BY id DESC;

-- Slowest routes today (avg and max)
SELECT method, path, COUNT(*) AS n, ROUND(AVG(duration_ms)) AS avg_ms, MAX(duration_ms) AS max_ms FROM api_logs
 WHERE created_at > UTC_DATE() GROUP BY method, path ORDER BY avg_ms DESC LIMIT 15;

-- Requests per hour (load)
SELECT DATE_FORMAT(created_at, '%Y-%m-%d %H:00') AS hour, COUNT(*) AS requests, SUM(status >= 400) AS errors
  FROM api_logs WHERE created_at > UTC_TIMESTAMP() - INTERVAL 1 DAY GROUP BY hour ORDER BY hour;
```

### Agents and settings

```sql
-- Full setup of one agent (+ its emergency contacts and template)
SELECT * FROM agents WHERE id = '0e1a116c'\G
SELECT label, contact_type, number, keywords FROM emergency_rules WHERE agent_id = '0e1a116c' ORDER BY sort_order;
SELECT t.id, t.name, t.greeting FROM agent_templates t JOIN agents a ON a.template_id = t.id WHERE a.id = '0e1a116c';

-- Shared app settings (one JSON per section)
SELECT section, updated_at, updated_by, value FROM app_config;
SELECT JSON_PRETTY(value) FROM app_config WHERE section = 'models';

-- Agents per type, and templates in use
SELECT agent_type, COUNT(*) FROM agents GROUP BY agent_type ORDER BY 2 DESC;
SELECT t.type_key, t.name, COUNT(a.id) AS agents FROM agent_templates t LEFT JOIN agents a ON a.template_id = t.id
 GROUP BY t.id ORDER BY t.type_key;
```

### Calls

```sql
-- Last calls of a user with cost and speed
SELECT id, agent_name, started_at, duration_seconds, ended_by, turns, tokens_total, avg_response_ms, recording_file
  FROM calls WHERE user_id = (SELECT id FROM users WHERE username = 'dj8323') ORDER BY started_at DESC LIMIT 20;

-- One call: transcript and summary
SELECT JSON_PRETTY(transcript) FROM calls WHERE id = 'abcd1234';
SELECT summary FROM call_summaries WHERE call_id = 'abcd1234';

-- Token use per day (OpenAI cost)
SELECT DATE(started_at) AS day, COUNT(*) AS calls, SUM(tokens_total) AS tokens, ROUND(AVG(avg_response_ms)) AS avg_reply_ms
  FROM calls GROUP BY day ORDER BY day DESC LIMIT 14;

-- Calls whose recording is missing
SELECT id, started_at, user_id FROM calls WHERE recording_file IS NULL ORDER BY started_at DESC LIMIT 20;
```

### Meetings and messages

```sql
SELECT start_at, duration_min, title, notes, agent_id FROM calendar_events
 WHERE user_id = (SELECT id FROM users WHERE username = 'dj8323') AND start_at > UTC_TIMESTAMP() ORDER BY start_at;
SELECT created_at, caller_name, caller_number, urgency, status, message FROM messages
 WHERE status = 'new' ORDER BY created_at DESC LIMIT 20;
```

### Housekeeping

```sql
-- Size of each table
SELECT TABLE_NAME, TABLE_ROWS, ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024 / 1024, 1) AS mb
  FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() ORDER BY mb DESC;

-- Trim old request logs (keep 90 days)
DELETE FROM api_logs WHERE created_at < UTC_TIMESTAMP() - INTERVAL 90 DAY;

-- Remove expired sessions
DELETE FROM sessions WHERE expires_at < UTC_TIMESTAMP();
```
