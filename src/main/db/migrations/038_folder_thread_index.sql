-- Thread and unread counts per folder (folder list, mailbox switcher, account
-- summary) read only this covering index instead of every message row.
CREATE INDEX IF NOT EXISTS idx_msg_folder_thread ON messages(folder_id, thread_key, seen);
