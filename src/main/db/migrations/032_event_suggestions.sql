-- Phase 2.4: event suggestions from mails (AI) + own job type 'events'.

-- ai_jobs.kind is restricted to ('triage','draft') via CHECK; SQLite cannot
-- alter CHECKs → rebuild the table (data is preserved).
DROP TABLE IF EXISTS ai_jobs_new;
CREATE TABLE ai_jobs_new (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('triage', 'draft', 'events')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT,
  UNIQUE (message_id, kind)
);
INSERT INTO ai_jobs_new (id, message_id, kind, status, attempts, next_attempt_at, last_error)
  SELECT id, message_id, kind, status, attempts, next_attempt_at, last_error FROM ai_jobs;
DROP TABLE ai_jobs;
ALTER TABLE ai_jobs_new RENAME TO ai_jobs;
CREATE INDEX idx_ai_jobs_pending ON ai_jobs(status, next_attempt_at);

-- Suggestions, like task suggestions: never automatically in the calendar, only after a click.
-- Content comes from mails (untrusted) and is only shown as plain text.
CREATE TABLE IF NOT EXISTS event_suggestions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_key    TEXT NOT NULL,
  title         TEXT NOT NULL,
  all_day       INTEGER NOT NULL DEFAULT 0,
  -- Wall time 'YYYY-MM-DDTHH:mm:ss' or for all-day 'YYYY-MM-DD' (end exclusive)
  start_local   TEXT NOT NULL,
  end_local     TEXT NOT NULL,
  -- stated IANA zone; NULL = user's time zone at creation
  tzid          TEXT,
  location      TEXT,
  link          TEXT,
  -- proposed = proposal/request, confirmed = binding
  kind          TEXT NOT NULL DEFAULT 'proposed' CHECK (kind IN ('proposed', 'confirmed')),
  confidence    REAL NOT NULL DEFAULT 0.5,
  -- new | accepted (added or handed over for editing) | dismissed
  state         TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'accepted', 'dismissed')),
  cal_object_id INTEGER REFERENCES cal_objects(id) ON DELETE SET NULL,
  model         TEXT,
  created_at    INTEGER NOT NULL
);
-- Dedupe across the thread: the same event (same start) is only suggested once
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_suggestions_dedupe
  ON event_suggestions(account_id, thread_key, start_local, all_day);
CREATE INDEX IF NOT EXISTS idx_event_suggestions_message ON event_suggestions(message_id);
CREATE INDEX IF NOT EXISTS idx_event_suggestions_thread ON event_suggestions(thread_key);
