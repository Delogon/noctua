-- Spam-Erkennung: Spam-Score der Hybrid-Triage (0..2 wie phishing) und eigenständige
-- Sicherheitsprüfungen des Entscheidungsmodells für Mails ohne Hybrid-Triage
-- (älter als das Triage-Fenster, andere Ordner, vor Aktivierung des Modells).
-- Die lokalen Regel-Signale werden nicht gespeichert, sondern bei Bedarf neu berechnet.
ALTER TABLE ai_decisions ADD COLUMN spam REAL;

CREATE TABLE IF NOT EXISTS mail_threat_checks (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  phishing REAL NOT NULL,
  spam REAL NOT NULL,
  created_at INTEGER NOT NULL
);
