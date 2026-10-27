-- Noctua schema v1: accounts, folders, messages, AI annotations, sync state.

CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'proton', 'imap')),
  credential_type TEXT NOT NULL CHECK (credential_type IN ('password', 'oauth-ms', 'bridge')),
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  tls_fingerprint256 TEXT,              -- Cert pinning (Proton Bridge)
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  created_at INTEGER NOT NULL
);

-- Values are safeStorage-encrypted ciphertexts, never plaintext.
CREATE TABLE secrets (
  key TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE folders (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  special_use TEXT,                     -- '\Inbox','\Sent','\Drafts','\Trash','\Junk','\Archive'
  uidvalidity INTEGER,
  uidnext INTEGER,
  highest_modseq INTEGER,
  sync_mode TEXT NOT NULL DEFAULT 'full' CHECK (sync_mode IN ('full', 'flags', 'off')),
  last_synced_at INTEGER,
  UNIQUE (account_id, path)
);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  uid INTEGER NOT NULL,
  gm_msgid TEXT,                        -- Gmail X-GM-MSGID (dedupe)
  gm_thrid TEXT,                        -- Gmail X-GM-THRID (authoritative threading)
  message_id TEXT,
  in_reply_to TEXT,
  refs TEXT,                            -- References header, whitespace-separated
  thread_key TEXT NOT NULL,
  subject TEXT,
  from_addr TEXT,
  from_name TEXT,
  to_json TEXT,
  cc_json TEXT,
  reply_to TEXT,
  date INTEGER,
  internal_date INTEGER,
  size INTEGER,
  seen INTEGER NOT NULL DEFAULT 0,
  flagged INTEGER NOT NULL DEFAULT 0,
  answered INTEGER NOT NULL DEFAULT 0,
  draft INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  snippet TEXT,
  body_state TEXT NOT NULL DEFAULT 'none' CHECK (body_state IN ('none', 'full')),
  UNIQUE (folder_id, uid)
);
CREATE INDEX idx_msg_thread ON messages(thread_key, date);
CREATE INDEX idx_msg_inbox ON messages(account_id, folder_id, date DESC);
CREATE INDEX idx_msg_msgid ON messages(message_id);
CREATE INDEX idx_msg_gm_msgid ON messages(gm_msgid);

CREATE TABLE message_bodies (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  text_plain TEXT,
  html_raw TEXT                         -- Sanitized only at render time (DOMPurify)
);

CREATE TABLE attachments (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  part_id TEXT NOT NULL,
  filename TEXT,
  mime_type TEXT,
  size INTEGER,
  content_id TEXT,                      -- for cid: inline images
  local_path TEXT                       -- NULL until downloaded
);
CREATE INDEX idx_att_message ON attachments(message_id);

CREATE TABLE ai_annotations (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN
    ('personal', 'work', 'newsletter', 'promotions', 'notifications', 'transactional', 'other')),
  priority INTEGER NOT NULL CHECK (priority BETWEEN 1 AND 5),
  summary TEXT,
  action_items_json TEXT,
  needs_reply INTEGER NOT NULL DEFAULT 0,
  confidence REAL,
  user_override_category TEXT,          -- manual correction permanently overrides the model
  model TEXT,
  prompt_version INTEGER NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd REAL,
  created_at INTEGER NOT NULL
);

-- UNIQUE(message_id, kind) doubles as the scan cache: never scan twice.
CREATE TABLE ai_jobs (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('triage', 'draft')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT,
  UNIQUE (message_id, kind)
);
CREATE INDEX idx_ai_jobs_pending ON ai_jobs(status, next_attempt_at);

CREATE TABLE ai_usage_log (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,                    -- 'YYYY-MM-DD'
  model TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  UNIQUE (day, model)
);

-- Offline-capable write operations towards IMAP (optimistic UI).
CREATE TABLE op_queue (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('setFlags', 'move', 'delete', 'append')),
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Priority boost ("has Tim ever written to them?") + style example selection.
CREATE TABLE contact_stats (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  addr TEXT NOT NULL,
  sent_count INTEGER NOT NULL DEFAULT 0,
  received_count INTEGER NOT NULL DEFAULT 0,
  last_interaction INTEGER,
  PRIMARY KEY (account_id, addr)
);

-- Contentless FTS5; rowid = messages.id, populated explicitly in the ingest code.
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, sender, recipients, body,
  content = '',
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);
