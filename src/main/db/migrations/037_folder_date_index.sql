-- Messages of a folder by date: AI triage discovery (Inbox, last 30 days) and
-- the body backfill selection read a date window per folder. Without this
-- index both walked every message of the folder on each pass.
CREATE INDEX IF NOT EXISTS idx_msg_folder_date ON messages(folder_id, coalesce(date, internal_date));
