-- Outbox reliability: stable Message-ID, retry counter, new state
-- 'unknown' (send interrupted, outcome uncertain — never blindly resend).
-- SQLite cannot alter CHECK constraints → rebuild the table.

CREATE TABLE outbox_new (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  send_at INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'sending', 'sent', 'canceled', 'error', 'unknown')),
  last_error TEXT,
  created_at INTEGER NOT NULL,
  message_id TEXT,                      -- generated on enqueue, sent as the Message-ID header
  attempts INTEGER NOT NULL DEFAULT 0   -- previous send attempts (retry limit)
);
INSERT INTO outbox_new (id, account_id, payload_json, send_at, state, last_error, created_at)
  SELECT id, account_id, payload_json, send_at, state, last_error, created_at FROM outbox;
DROP TABLE outbox;
ALTER TABLE outbox_new RENAME TO outbox;
CREATE INDEX idx_outbox_pending ON outbox(state, send_at);
