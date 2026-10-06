-- Phase 2.1: CalDAV-Kern. Kalender-Konten sind eigenständig (nicht an Mail-
-- Konten gekoppelt); das Passwort liegt im Vault unter `cal:<id>:password`.
-- Server-URLs und Collection-URLs sind absolut, Objekt-Hrefs normalisierte Pfade
-- relativ zum Origin der Kalender-URL.
CREATE TABLE IF NOT EXISTS cal_accounts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  server_url           TEXT NOT NULL,
  principal_url        TEXT,
  home_url             TEXT NOT NULL,
  username             TEXT NOT NULL,
  -- Mail-Konto, aus dem Host/Zugangsdaten vorbelegt wurden (nur Hinweis)
  mail_account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  -- Scheduling (RFC 6638): für spätere Pakete (Einladungen, Free/Busy)
  schedule_inbox_url   TEXT,
  schedule_outbox_url  TEXT,
  user_addresses       TEXT NOT NULL DEFAULT '[]',
  auto_schedule        INTEGER NOT NULL DEFAULT 0,
  dav_capabilities     TEXT NOT NULL DEFAULT '[]',
  state                TEXT NOT NULL DEFAULT 'off'
                         CHECK (state IN ('idle', 'connecting', 'syncing', 'error', 'needs-reauth', 'off')),
  last_error           TEXT,
  last_sync            INTEGER,
  created_at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS calendars (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id        INTEGER NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  display_name      TEXT NOT NULL,
  color             TEXT,
  -- Komma-getrennt, z. B. 'VEVENT,VTODO'
  components        TEXT NOT NULL DEFAULT 'VEVENT',
  read_only         INTEGER NOT NULL DEFAULT 0,
  supports_sync     INTEGER NOT NULL DEFAULT 0,
  ctag              TEXT,
  sync_token        TEXT,
  visible           INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  -- Vom Nutzer gesetzte Farbe überschreibt die Server-Farbe beim Sync nicht
  color_user_set    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (account_id, url)
);
CREATE INDEX IF NOT EXISTS idx_calendars_account ON calendars(account_id);

CREATE TABLE IF NOT EXISTS cal_objects (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  calendar_id    INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  href           TEXT NOT NULL,
  etag           TEXT,
  uid            TEXT NOT NULL,
  -- VEVENT | VTODO | VJOURNAL | INVALID (nicht parsebar, Rohtext bleibt erhalten)
  component      TEXT NOT NULL DEFAULT 'VEVENT',
  ics            TEXT NOT NULL,
  summary        TEXT,
  location       TEXT,
  dtstart_utc    INTEGER,
  dtend_utc      INTEGER,
  tzid           TEXT,
  all_day        INTEGER NOT NULL DEFAULT 0,
  has_rrule      INTEGER NOT NULL DEFAULT 0,
  status         TEXT,
  organizer      TEXT,
  sequence       INTEGER NOT NULL DEFAULT 0,
  last_modified  INTEGER,
  -- Lokale, noch nicht übertragene Änderung ('create' | 'update' | 'delete')
  pending_op     TEXT CHECK (pending_op IN ('create', 'update', 'delete')),
  UNIQUE (calendar_id, href)
);
CREATE INDEX IF NOT EXISTS idx_cal_objects_uid ON cal_objects(calendar_id, uid);
CREATE INDEX IF NOT EXISTS idx_cal_objects_recurring ON cal_objects(calendar_id, has_rrule);

-- Materialisierte Vorkommen. Nicht-wiederkehrende Objekte immer, wiederkehrende
-- für ein rollendes Fenster (siehe docs/CALDAV.md). Ganztägige Einträge tragen
-- zusätzlich Kalendertage (start_day inklusiv, end_day exklusiv, 'YYYY-MM-DD').
CREATE TABLE IF NOT EXISTS cal_instances (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id      INTEGER NOT NULL REFERENCES cal_objects(id) ON DELETE CASCADE,
  calendar_id    INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  -- Ursprünglicher Start des Vorkommens als UTC-ISO ('YYYY-MM-DDTHH:mm:ssZ') bzw. Datum; NULL = nicht wiederkehrend
  recurrence_id  TEXT,
  start_utc      INTEGER NOT NULL,
  end_utc        INTEGER NOT NULL,
  all_day        INTEGER NOT NULL DEFAULT 0,
  start_day      TEXT,
  end_day        TEXT,
  is_override    INTEGER NOT NULL DEFAULT 0,
  summary        TEXT,
  location       TEXT,
  status         TEXT
);
CREATE INDEX IF NOT EXISTS idx_cal_instances_range ON cal_instances(calendar_id, start_utc, end_utc);
CREATE INDEX IF NOT EXISTS idx_cal_instances_time ON cal_instances(start_utc, end_utc);
CREATE INDEX IF NOT EXISTS idx_cal_instances_day ON cal_instances(all_day, start_day, end_day);
CREATE INDEX IF NOT EXISTS idx_cal_instances_object ON cal_instances(object_id);

-- Offline-first: lokale Änderungen warten hier auf die Übertragung. Wie die
-- Mail-Op-Queue: Versuche zählen, danach 'dead' (mit Grund) statt stilles Löschen.
CREATE TABLE IF NOT EXISTS cal_pending_ops (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  calendar_id  INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  object_id    INTEGER REFERENCES cal_objects(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
  href         TEXT NOT NULL,
  uid          TEXT NOT NULL,
  -- ETag, auf dem die lokale Änderung aufbaut (If-Match); NULL bei 'create'
  base_etag    TEXT,
  -- Beim Verwerfen (Konflikt) bleibt die lokale Fassung hier erhalten
  ics          TEXT,
  summary      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dead')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_pending_ops_account ON cal_pending_ops(account_id, status, id);

-- Bereits ausgelöste Erinnerungen (kein doppeltes Feuern nach Neustart)
CREATE TABLE IF NOT EXISTS cal_reminders_fired (
  object_id      INTEGER NOT NULL REFERENCES cal_objects(id) ON DELETE CASCADE,
  recurrence_id  TEXT NOT NULL DEFAULT '',
  alarm_key      TEXT NOT NULL,
  fire_at        INTEGER NOT NULL,
  fired_at       INTEGER NOT NULL,
  PRIMARY KEY (object_id, recurrence_id, alarm_key, fire_at)
);
