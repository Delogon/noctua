-- Full mail header data is only loaded on expand and stays strictly
-- local. That way the normal thread read bloats neither IPC nor sync.
CREATE TABLE message_header_details (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  from_json TEXT NOT NULL DEFAULT '[]',
  sender_json TEXT NOT NULL DEFAULT '[]',
  to_json TEXT NOT NULL DEFAULT '[]',
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  reply_to_json TEXT NOT NULL DEFAULT '[]',
  raw_headers TEXT NOT NULL,
  raw_headers_truncated INTEGER NOT NULL DEFAULT 0,
  fetched_at INTEGER NOT NULL
);
