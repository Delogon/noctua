-- Drafts survive thread switches and restarts: one draft per thread.
-- display_name/subject are copied from messages on save so that
-- the owl bar can also label drafts of archived threads.
CREATE TABLE drafts (
  thread_key TEXT PRIMARY KEY,
  display_name TEXT,
  subject TEXT,
  text TEXT NOT NULL,
  html TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
