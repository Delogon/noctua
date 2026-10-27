-- Phase 3.2: tasks <-> CalDAV VTODO. Maps a Noctua task to a
-- VTODO of the selected task list. Deliberately without FK on tasks: deleted
-- tasks are detected via the orphaned mapping and deleted on the server.
CREATE TABLE IF NOT EXISTS task_caldav (
  task_id      INTEGER PRIMARY KEY,
  calendar_id  INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  uid          TEXT NOT NULL,
  -- Hash of the last reconciled fields (title, note, due date, done)
  synced_hash  TEXT,
  -- ETag we last saw as "known"; NULL = never confirmed
  synced_etag  TEXT,
  last_synced  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_task_caldav_uid ON task_caldav(calendar_id, uid);
