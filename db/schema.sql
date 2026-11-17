-- TelemuneSmartAi database (MySQL 8). Run automatically by db.js on every start (everything is IF NOT EXISTS),
-- or by hand:  mysql -uroot -p < db/schema.sql
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
  voice             VARCHAR(20)  NOT NULL DEFAULT 'marin',
  chat_model        VARCHAR(80)  NULL,
  tts_model         VARCHAR(80)  NULL,
  stt_engine        VARCHAR(10)  NULL,   -- openai | browser
  stt_model         VARCHAR(80)  NULL,
  playbook_id       VARCHAR(16)  NULL,
  calendar_enabled  TINYINT(1)   NOT NULL DEFAULT 0,
  emergency_enabled TINYINT(1)   NOT NULL DEFAULT 0,
  is_default        TINYINT(1)   NOT NULL DEFAULT 0,
  created_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_agents_user (user_id),
  CONSTRAINT fk_agents_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);

-- Emergency numbers + keywords, per agent.
CREATE TABLE IF NOT EXISTS emergency_rules (
  id         INT          NOT NULL AUTO_INCREMENT PRIMARY KEY,
  agent_id   VARCHAR(16)  NOT NULL,
  label      VARCHAR(40)  NOT NULL,
  number     VARCHAR(20)  NOT NULL,
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
  playbook         JSON         NULL,
  language         VARCHAR(40)  NOT NULL DEFAULT '',
  voice            VARCHAR(20)  NOT NULL DEFAULT '',
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
  user_id    VARCHAR(16)  NULL,
  username   VARCHAR(64)  NOT NULL DEFAULT '',
  action     VARCHAR(40)  NOT NULL,
  target     VARCHAR(120) NOT NULL DEFAULT '',
  details    JSON         NULL,
  ip         VARCHAR(64)  NOT NULL DEFAULT '',
  created_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_activity_created (created_at),
  INDEX idx_activity_user (user_id, created_at)
);

-- Every API request: method, path, status and how long it took.
CREATE TABLE IF NOT EXISTS api_logs (
  id          BIGINT       NOT NULL AUTO_INCREMENT PRIMARY KEY,
  user_id     VARCHAR(16)  NULL,
  agent_id    VARCHAR(16)  NULL,
  method      VARCHAR(8)   NOT NULL,
  path        VARCHAR(200) NOT NULL,
  status      SMALLINT     NOT NULL,
  duration_ms INT          NOT NULL,
  ip          VARCHAR(64)  NOT NULL DEFAULT '',
  created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX idx_api_created (created_at),
  INDEX idx_api_user (user_id, created_at)
);
