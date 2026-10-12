-- Follow-up radar: sent mails awaiting a reply.
CREATE TABLE followups (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  thread_key TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting' CHECK (state IN ('waiting', 'resolved', 'dismissed')),
  expects_reply INTEGER,               -- NULL = unchecked, 0/1 = AI verdict
  checked_at INTEGER,
  resolved_at INTEGER
);
CREATE INDEX idx_followups_state ON followups(state);
