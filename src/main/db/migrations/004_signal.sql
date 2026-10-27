-- Signal integration: groups (opt-in for reading AND for AI scanning) + messages.
CREATE TABLE signal_groups (
  id INTEGER PRIMARY KEY,
  group_id TEXT NOT NULL UNIQUE,        -- base64 group ID from signal-cli
  name TEXT,
  monitored INTEGER NOT NULL DEFAULT 0, -- only monitored groups are stored
  ai_enabled INTEGER NOT NULL DEFAULT 0,
  last_message_at INTEGER
);

CREATE TABLE signal_messages (
  id INTEGER PRIMARY KEY,
  group_pk INTEGER NOT NULL REFERENCES signal_groups(id) ON DELETE CASCADE,
  sender_name TEXT,
  sender_number TEXT,
  timestamp INTEGER NOT NULL,
  body TEXT,
  ai_summary TEXT,
  ai_priority INTEGER,
  ai_processed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (group_pk, sender_number, timestamp)
);
CREATE INDEX idx_signal_msgs ON signal_messages(group_pk, timestamp DESC);
