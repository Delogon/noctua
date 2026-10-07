-- Entscheidungsmodelle (Ollama System One): rohe Wahrscheinlichkeiten je Mail.
-- Triage schreibt sie in einem Aufruf; Termin-Job (proposes_meeting), Phishing-Hinweis
-- und Regeln mit KI-Bedingung lesen sie. ai_annotations bleibt unverändert.
CREATE TABLE IF NOT EXISTS ai_decisions (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  category TEXT,
  category_confidence REAL,
  -- score 0..4 (fünf geordnete Stufen), nicht gerundet
  priority_score REAL,
  -- Wahrscheinlichkeiten 0..1 (noul)
  needs_reply REAL,
  addressed_to_me REAL,
  has_request REAL,
  proposes_meeting REAL,
  -- score 0..2 (unauffällig / verdächtig / wahrscheinlich Phishing)
  phishing REAL,
  -- JSON-Array lokaler Signale (z. B. ["reply_to_differs","link_mismatch:2"])
  phishing_signals_json TEXT,
  created_at INTEGER NOT NULL
);
