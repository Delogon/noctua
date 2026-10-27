-- Owl conversations: Q&A histories of the owl view survive restarts.
-- messages_json holds the complete history as a JSON array
-- [{role, content, at?, sources?}] — the owl remembers instead of forgetting.
CREATE TABLE owl_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  messages_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_owl_conversations_updated ON owl_conversations (updated_at DESC);
