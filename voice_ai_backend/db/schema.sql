-- TelemuneSmartAi database (MySQL 8). Run automatically by the Spring Boot backend on every start (everything is
-- IF NOT EXISTS; new columns on old tables are added by backend/.../db/Db.java), or by hand:  mysql -uroot -p < db/schema.sql
-- Ready-made agent types and templates are in db/seed.sql (INSERT IGNORE, so edits made in the app are kept).
-- All times are stored in UTC.

CREATE DATABASE IF NOT EXISTS `ai-agent` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ai-agent`;

-- Roles: 1 = admin (dashboard over every user), 2 = user (own agents and data only).
CREATE TABLE IF NOT EXISTS roles (
  id          TINYINT      NOT NULL PRIMARY KEY,
  name        VARCHAR(30)  NOT NULL UNIQUE,
  description VARCHAR(200) NOT NULL DEFAULT ''
);
INSERT IGNORE INTO roles (id, name, description) VALUES
  (1, 'admin', 'Sees every user, agent, call and log; manages accounts and app settings'),
  (2, 'user',  'Uses and manages only their own agents, playbooks, calls and calendar');

-- Accounts. Passwords are scrypt hashes, never plain text. Deleted users are kept (deleted_at set) so data is recoverable.
CREATE TABLE IF NOT EXISTS users (
  id                   VARCHAR(16)  NOT NULL PRIMARY KEY,
  username             VARCHAR(64)  NOT NULL UNIQUE,
  name                 VARCHAR(60)  NOT NULL,
  email                VARCHAR(120) NULL,
  role_id              TINYINT      NOT NULL DEFAULT 2,
  password_hash        VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1)   NOT NULL DEFAULT 0,
  disabled             TINYINT(1)   NOT NULL DEFAULT 0,
  signup_source        VARCHAR(10)  NOT NULL DEFAULT 'admin',   -- setup | admin | self | import
  created_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  last_login_at        DATETIME(3)  NULL,
  deleted_at           DATETIME(3)  NULL,
  CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles (id)
);

-- Sign-in sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash   CHAR(64)     NOT NULL PRIMARY KEY,
  user_id      VARCHAR(16)  NOT NULL,
  ip           VARCHAR(64)  NOT NULL DEFAULT '',
  user_agent   VARCHAR(255) NOT NULL DEFAULT '',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expires_at   DATETIME(3)  NOT NULL,
  INDEX idx_sessions_user (user_id),
  INDEX idx_sessions_expires (expires_at),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Shared app settings, one JSON document per section (branding, agent, models, speechToText, conversation,
-- history, calendar, emergency, auth). These are the defaults every agent starts from. Seeded from config.json.
CREATE TABLE IF NOT EXISTS app_config (
  section    VARCHAR(40) NOT NULL PRIMARY KEY,
  value      JSON        NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by VARCHAR(16) NULL
);

-- Agents: each user can have many (personal, hospital, HR, banking …). Each agent has its own setup;
-- changing one never touches another agent or another user. NULL model columns = use the app default.
CREATE TABLE IF NOT EXISTS agents (
  id                VARCHAR(16)  NOT NULL PRIMARY KEY,
  user_id           VARCHAR(16)  NOT NULL,
  name              VARCHAR(40)  NOT NULL,
  agent_type        VARCHAR(30)  NOT NULL DEFAULT 'personal',
  description       VARCHAR(300) NOT NULL DEFAULT '',
  language          VARCHAR(10)  NOT NULL DEFAULT 'en-US',
  voice             VARCHAR(64)  NOT NULL DEFAULT 'marin',   -- voice id of the TTS provider (OpenAI name, ElevenLabs/Cartesia id, Polly name)
  chat_model        VARCHAR(80)  NULL,
  tts_provider      VARCHAR(20)  NULL,   -- openai | aws | elevenlabs | cartesia; NULL = openai
  tts_model         VARCHAR(80)  NULL,
  stt_provider      VARCHAR(20)  NULL,   -- openai | elevenlabs | aws; NULL = openai
  stt_engine        VARCHAR(10)  NULL,   -- openai (= a provider above) | browser
  stt_model         VARCHAR(80)  NULL,
  playbook_id       VARCHAR(16)  NULL,
  calendar_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  emergency_enabled TINYINT(1)   NOT NULL DEFAULT 0,
  is_default        TINYINT(1)   NOT NULL DEFAULT 0,
  template_id       VARCHAR(40)  NULL,                    -- agent_templates.id (the script/persona it runs)
  owner_name        VARCHAR(60)  NOT NULL DEFAULT '',     -- who the agent works for, e.g. "DJ"
  organization      VARCHAR(80)  NOT NULL DEFAULT '',     -- e.g. "City Hospital"
  owner_availability VARCHAR(300) NOT NULL DEFAULT '',    -- e.g. "Weekdays 3 to 6 pm"
  greeting          VARCHAR(400) NOT NULL DEFAULT '',     -- own first line; empty = the template's greeting
  availability_plan JSON         NULL,                    -- {days:[1..7], from:"15:00", to:"18:00", tz, note}; owner_availability is its text
  meeting_minutes   INT          NULL,                    -- meeting length for calendar bookings; NULL = app default
  speech_speed      DECIMAL(3,2) NULL,                    -- how fast the agent speaks (0.50–2.00, 1 = normal); NULL = app default
  notify            JSON         NULL,                    -- send call summaries: {whatsapp:{on,to}, email:{on,to}, sms:{on,to}}
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_agents_user (user_id),
  CONSTRAINT fk_agents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Emergency numbers + keywords, per agent.
CREATE TABLE IF NOT EXISTS emergency_rules (
  id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agent_id   VARCHAR(16)  NOT NULL,
  label        VARCHAR(40)  NOT NULL,
  contact_type VARCHAR(10)  NOT NULL DEFAULT 'phone',   -- phone | whatsapp | email
  number       VARCHAR(120) NOT NULL,                   -- phone / WhatsApp number, or email address when contact_type = email
  keywords   JSON         NOT NULL,
  sort_order INT          NOT NULL DEFAULT 0,
  INDEX idx_emergency_agent (agent_id),
  CONSTRAINT fk_emergency_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE CASCADE
);

-- Playbooks a user saved (any of their agents can use them).
CREATE TABLE IF NOT EXISTS playbooks (
  id            VARCHAR(16)  NOT NULL PRIMARY KEY,
  user_id       VARCHAR(16)  NOT NULL,
  agent_type    VARCHAR(30)  NOT NULL DEFAULT 'other',
  name          VARCHAR(60)  NOT NULL,
  role          VARCHAR(200) NOT NULL DEFAULT '',
  goal          VARCHAR(400) NOT NULL,
  steps         JSON         NOT NULL,
  rules         JSON         NOT NULL,
  summary_focus VARCHAR(300) NOT NULL DEFAULT '',
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_playbooks_user (user_id),
  CONSTRAINT fk_playbooks_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Finished calls. The recording audio stays on disk (data/users/<userId>/recordings/<recording_file>).
CREATE TABLE IF NOT EXISTS calls (
  id               VARCHAR(16)  NOT NULL PRIMARY KEY,
  user_id          VARCHAR(16)  NOT NULL,
  agent_id         VARCHAR(16)  NULL,
  agent_name       VARCHAR(40)  NOT NULL DEFAULT '',
  started_at       DATETIME(3)  NOT NULL,
  ended_at         DATETIME(3)  NOT NULL,
  duration         VARCHAR(12)  NOT NULL DEFAULT '00:00',
  duration_seconds INT          NOT NULL DEFAULT 0,
  ended_by         VARCHAR(40)  NOT NULL DEFAULT 'user',
  channel          VARCHAR(10)  NOT NULL DEFAULT 'call',   -- call | chat (live chat) | voice (voice chat) | whatsapp (message sent)
  playbook         JSON         NULL,
  language         VARCHAR(40)  NOT NULL DEFAULT '',
  voice            VARCHAR(64)  NOT NULL DEFAULT '',
  turns            INT          NOT NULL DEFAULT 0,
  tokens_input     INT          NOT NULL DEFAULT 0,
  tokens_output    INT          NOT NULL DEFAULT 0,
  tokens_total     INT          NOT NULL DEFAULT 0,
  avg_response_ms  INT          NULL,
  stats            JSON         NOT NULL,
  transcript       JSON         NOT NULL,
  recording_file   VARCHAR(120) NULL,
  recording_type   VARCHAR(40)  NULL,
  recording_bytes  INT          NULL,
  INDEX idx_calls_user_started (user_id, started_at),
  INDEX idx_calls_agent (agent_id),
  CONSTRAINT fk_calls_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_calls_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE SET NULL
);

-- The AI summary of each call, plus the full printable summary (what the ⬇ summary .txt download returns).
CREATE TABLE IF NOT EXISTS call_summaries (
  call_id    VARCHAR(16) NOT NULL PRIMARY KEY,
  summary    TEXT        NOT NULL,
  full_text  MEDIUMTEXT  NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_summaries_call FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE CASCADE
);

-- Calendar events the agents add during calls (when Calendar is on for that agent).
CREATE TABLE IF NOT EXISTS calendar_events (
  id           VARCHAR(16)  NOT NULL PRIMARY KEY,
  user_id      VARCHAR(16)  NOT NULL,
  agent_id     VARCHAR(16)  NULL,
  title        VARCHAR(120) NOT NULL,
  start_at     DATETIME(3)  NOT NULL,
  duration_min INT          NOT NULL DEFAULT 30,
  notes        VARCHAR(500) NOT NULL DEFAULT '',
  source       VARCHAR(40)  NOT NULL DEFAULT 'agent',
  created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_events_user_start (user_id, start_at),
  CONSTRAINT fk_events_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_events_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE SET NULL
);

-- Who did what: sign-ins, sign-ups, account changes, agent/setting changes, calls saved or deleted …
-- No foreign keys, so the history stays even after a user is deleted.
CREATE TABLE IF NOT EXISTS activity_logs (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(16)  NULL,          -- same id as [reqId] in logs/*.log and the X-Request-Id header
  user_id    VARCHAR(16)  NULL,
  username   VARCHAR(64)  NOT NULL DEFAULT '',
  action     VARCHAR(40)  NOT NULL,
  target     VARCHAR(120) NOT NULL DEFAULT '',
  details    JSON         NULL,
  ip         VARCHAR(64)  NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_activity_created (created_at),
  INDEX idx_activity_user (user_id, created_at),
  INDEX idx_activity_request (request_id)
);

-- Every API request: method, path, status and how long it took.
CREATE TABLE IF NOT EXISTS api_logs (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  request_id  VARCHAR(16)  NULL,         -- same id as [reqId] in logs/*.log and the X-Request-Id header
  user_id     VARCHAR(16)  NULL,
  agent_id    VARCHAR(16)  NULL,
  method      VARCHAR(8)   NOT NULL,
  path        VARCHAR(200) NOT NULL,
  status      SMALLINT     NOT NULL,
  duration_ms INT          NOT NULL,
  ip          VARCHAR(64)  NOT NULL DEFAULT '',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_api_created (created_at),
  INDEX idx_api_user (user_id, created_at),
  INDEX idx_api_request (request_id)
);

-- Agent types (Personal, Call assistant, Hospital, Banking …). Admins edit them in the dashboard (🧩 Agent templates).
-- Text fields may use {agent}, {owner}, {org}; [[ … ]] is dropped when a value inside it is empty.
CREATE TABLE IF NOT EXISTS agent_types (
  type_key         VARCHAR(30)  NOT NULL PRIMARY KEY,
  name             VARCHAR(60)  NOT NULL,
  icon             VARCHAR(16)  NOT NULL DEFAULT '✨',
  description      VARCHAR(300) NOT NULL DEFAULT '',
  role             VARCHAR(300) NOT NULL DEFAULT '',     -- persona used when the agent has no template
  greeting         VARCHAR(400) NOT NULL DEFAULT '',     -- first line of every call
  needs_owner      TINYINT(1)   NOT NULL DEFAULT 0,      -- 1 = asks "works for whom?" when creating the agent
  default_calendar TINYINT(1)   NOT NULL DEFAULT 0,      -- 1 = calendar on for new agents of this type
  sort_order       INT          NOT NULL DEFAULT 0,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by       VARCHAR(16)  NULL
);

-- Ready-made scripts (persona + goal + steps + rules) for each type. Agents point at one (agents.template_id),
-- so a change here reaches every agent using it on its next call.
CREATE TABLE IF NOT EXISTS agent_templates (
  id            VARCHAR(40)  NOT NULL PRIMARY KEY,
  type_key      VARCHAR(30)  NOT NULL,
  name          VARCHAR(60)  NOT NULL,
  role          VARCHAR(300) NOT NULL DEFAULT '',        -- persona: who the agent is
  greeting      VARCHAR(400) NOT NULL DEFAULT '',        -- empty = the type's greeting
  goal          VARCHAR(400) NOT NULL DEFAULT '',
  steps         JSON         NOT NULL,
  rules         JSON         NOT NULL,
  summary_focus VARCHAR(300) NOT NULL DEFAULT '',
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,         -- pre-selected when creating an agent of this type
  sort_order    INT          NOT NULL DEFAULT 0,
  active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  updated_by    VARCHAR(16)  NULL,
  INDEX idx_templates_type (type_key, sort_order),
  CONSTRAINT fk_templates_type FOREIGN KEY (type_key) REFERENCES agent_types (type_key) ON DELETE CASCADE
);

-- Messages callers leave with an agent ("tell DJ I called about the contract").
CREATE TABLE IF NOT EXISTS messages (
  id            VARCHAR(16)   NOT NULL PRIMARY KEY,
  user_id       VARCHAR(16)   NOT NULL,
  agent_id      VARCHAR(16)   NULL,
  agent_name    VARCHAR(40)   NOT NULL DEFAULT '',
  for_name      VARCHAR(60)   NOT NULL DEFAULT '',       -- who the message is for (the agent's owner)
  caller_name   VARCHAR(80)   NOT NULL DEFAULT '',
  caller_number VARCHAR(30)   NOT NULL DEFAULT '',
  urgency       VARCHAR(10)   NOT NULL DEFAULT 'normal', -- normal | urgent
  message       VARCHAR(1000) NOT NULL,
  status        VARCHAR(10)   NOT NULL DEFAULT 'new',    -- new | done
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  done_at       DATETIME(3)   NULL,
  INDEX idx_messages_user (user_id, created_at),
  INDEX idx_messages_agent (agent_id, created_at),
  CONSTRAINT fk_messages_user  FOREIGN KEY (user_id)  REFERENCES users (id)  ON DELETE CASCADE,
  CONSTRAINT fk_messages_agent FOREIGN KEY (agent_id) REFERENCES agents (id) ON DELETE SET NULL
);

-- Every sign-in attempt (ok or not). Also drives the lockout: 5 failures per username+IP in 5 minutes.
CREATE TABLE IF NOT EXISTS login_attempts (
  id         BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  username   VARCHAR(64)  NOT NULL,
  user_id    VARCHAR(16)  NULL,
  ip         VARCHAR(64)  NOT NULL DEFAULT '',
  user_agent VARCHAR(255) NOT NULL DEFAULT '',
  success    TINYINT(1)   NOT NULL,
  reason     VARCHAR(80)  NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_login_user_ip (username, ip, created_at)
);

-- Country dialling codes for mobile numbers (WhatsApp send, WhatsApp call summaries). Seeded by seed.sql; an admin can
-- add rows or switch some off (active = 0). digits = usual length of the national number (for a quick check; 0 = any).
CREATE TABLE IF NOT EXISTS country_codes (
  iso2       CHAR(2)      NOT NULL PRIMARY KEY,   -- IN, US, AE …
  name       VARCHAR(60)  NOT NULL,
  dial_code  VARCHAR(6)   NOT NULL,               -- digits only, e.g. 91, 1, 971
  flag       VARCHAR(8)   NOT NULL DEFAULT '',
  digits     INT          NOT NULL DEFAULT 0,
  sort_order INT          NOT NULL DEFAULT 100,
  active     TINYINT(1)   NOT NULL DEFAULT 1
);
