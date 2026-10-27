-- Decision models (Ollama System One): raw probabilities per mail.
-- Triage writes them in one call; event job (proposes_meeting), phishing hint
-- and rules with an AI condition read them. ai_annotations stays unchanged.
CREATE TABLE IF NOT EXISTS ai_decisions (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  category TEXT,
  category_confidence REAL,
  -- score 0..4 (five ordered levels), not rounded
  priority_score REAL,
  -- probabilities 0..1 (noul)
  needs_reply REAL,
  addressed_to_me REAL,
  has_request REAL,
  proposes_meeting REAL,
  -- score 0..2 (inconspicuous / suspicious / likely phishing)
  phishing REAL,
  -- JSON array of local signals (e.g. ["reply_to_differs","link_mismatch:2"])
  phishing_signals_json TEXT,
  created_at INTEGER NOT NULL
);
