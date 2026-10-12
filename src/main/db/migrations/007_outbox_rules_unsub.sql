-- M10: Undo Send (outbox), NL rules, unsubscribe header values.

CREATE TABLE outbox (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,           -- to/cc/subject/textBody/replyToMessageId
  send_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'canceled', 'error')),
  last_error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_outbox_pending ON outbox(state, send_at);

CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  source_text TEXT NOT NULL,            -- the user's original wording
  rule_json TEXT NOT NULL,              -- deterministic match/action definition
  needs_ai INTEGER NOT NULL DEFAULT 0,  -- references category/priority → post-triage phase
  enabled INTEGER NOT NULL DEFAULT 1,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

ALTER TABLE messages ADD COLUMN list_unsubscribe_url TEXT;
ALTER TABLE messages ADD COLUMN list_unsubscribe_post INTEGER NOT NULL DEFAULT 0;
