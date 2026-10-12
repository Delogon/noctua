-- Spam detection: spam score of the hybrid triage (0..2 like phishing) and standalone
-- security checks of the decision model for mails without hybrid triage
-- (older than the triage window, other folders, before the model was enabled).
-- The local rule signals are not stored but recomputed on demand.
ALTER TABLE ai_decisions ADD COLUMN spam REAL;

CREATE TABLE IF NOT EXISTS mail_threat_checks (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  phishing REAL NOT NULL,
  spam REAL NOT NULL,
  created_at INTEGER NOT NULL
);
