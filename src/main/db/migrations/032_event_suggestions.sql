-- Phase 2.4: Terminvorschläge aus Mails (AI) + eigener Job-Typ 'events'.

-- ai_jobs.kind ist per CHECK auf ('triage','draft') beschränkt; SQLite kann
-- CHECKs nicht ändern → Tabelle neu aufbauen (Daten bleiben erhalten).
DROP TABLE IF EXISTS ai_jobs_new;
CREATE TABLE ai_jobs_new (
  id INTEGER PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('triage', 'draft', 'events')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'done', 'error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  last_error TEXT,
  UNIQUE (message_id, kind)
);
INSERT INTO ai_jobs_new (id, message_id, kind, status, attempts, next_attempt_at, last_error)
  SELECT id, message_id, kind, status, attempts, next_attempt_at, last_error FROM ai_jobs;
DROP TABLE ai_jobs;
ALTER TABLE ai_jobs_new RENAME TO ai_jobs;
CREATE INDEX idx_ai_jobs_pending ON ai_jobs(status, next_attempt_at);

-- Vorschläge, wie Aufgaben-Vorschläge: nie automatisch im Kalender, erst nach Klick.
-- Inhalt stammt aus Mails (unvertrauenswürdig) und wird nur als Klartext angezeigt.
CREATE TABLE IF NOT EXISTS event_suggestions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id    INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  thread_key    TEXT NOT NULL,
  title         TEXT NOT NULL,
  all_day       INTEGER NOT NULL DEFAULT 0,
  -- Wandzeit 'YYYY-MM-DDTHH:mm:ss' bzw. bei ganztägig 'YYYY-MM-DD' (Ende exklusiv)
  start_local   TEXT NOT NULL,
  end_local     TEXT NOT NULL,
  -- genannte IANA-Zone; NULL = Zeitzone des Nutzers beim Anlegen
  tzid          TEXT,
  location      TEXT,
  link          TEXT,
  -- proposed = Vorschlag/Anfrage, confirmed = verbindlich
  kind          TEXT NOT NULL DEFAULT 'proposed' CHECK (kind IN ('proposed', 'confirmed')),
  confidence    REAL NOT NULL DEFAULT 0.5,
  -- new | accepted (hinzugefügt oder zum Bearbeiten übergeben) | dismissed
  state         TEXT NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'accepted', 'dismissed')),
  cal_object_id INTEGER REFERENCES cal_objects(id) ON DELETE SET NULL,
  model         TEXT,
  created_at    INTEGER NOT NULL
);
-- Dedupe über den Thread: derselbe Termin (gleicher Start) wird nur einmal vorgeschlagen
CREATE UNIQUE INDEX IF NOT EXISTS idx_event_suggestions_dedupe
  ON event_suggestions(account_id, thread_key, start_local, all_day);
CREATE INDEX IF NOT EXISTS idx_event_suggestions_message ON event_suggestions(message_id);
CREATE INDEX IF NOT EXISTS idx_event_suggestions_thread ON event_suggestions(thread_key);
