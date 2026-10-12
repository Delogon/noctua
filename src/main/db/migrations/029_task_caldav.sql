-- Phase 3.2: Aufgaben <-> CalDAV-VTODO. Zuordnung einer Noctua-Aufgabe zu einem
-- VTODO der gewählten Aufgabenliste. Bewusst ohne FK auf tasks: gelöschte
-- Aufgaben werden am verwaisten Mapping erkannt und serverseitig gelöscht.
CREATE TABLE IF NOT EXISTS task_caldav (
  task_id      INTEGER PRIMARY KEY,
  calendar_id  INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  uid          TEXT NOT NULL,
  -- Hash der zuletzt abgeglichenen Felder (Titel, Notiz, Fälligkeit, erledigt)
  synced_hash  TEXT,
  -- ETag, den wir zuletzt als „bekannt“ gesehen haben; NULL = noch nie bestätigt
  synced_etag  TEXT,
  last_synced  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_caldav_uid ON task_caldav(calendar_id, uid);
