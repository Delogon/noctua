-- Body backfill: failed fetch attempts survive restarts, so messages that can
-- never be fetched (deleted on the server, broken MIME) are not retried on
-- every poll forever.
ALTER TABLE messages ADD COLUMN body_attempts INTEGER NOT NULL DEFAULT 0;

-- Pending selection per folder, newest first: holds only messages without a
-- body, so a pass no longer reads and sorts the whole folder.
CREATE INDEX IF NOT EXISTS idx_msg_body_pending
  ON messages(folder_id, coalesce(date, internal_date))
  WHERE body_state = 'none';
