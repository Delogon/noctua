-- Phase 2.1: CalDAV core. Calendar accounts are standalone (not tied to mail
-- accounts); the password lives in the vault under `cal:<id>:password`.
-- Server URLs and collection URLs are absolute, object hrefs normalized paths
-- relative to the origin of the calendar URL.
CREATE TABLE IF NOT EXISTS cal_accounts (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  name                 TEXT NOT NULL,
  server_url           TEXT NOT NULL,
  principal_url        TEXT,
  home_url             TEXT NOT NULL,
  username             TEXT NOT NULL,
  -- Mail account the host/credentials were prefilled from (informational only)
  mail_account_id      INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  -- Scheduling (RFC 6638): for later packages (invitations, free/busy)
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
  -- Comma-separated, e.g. 'VEVENT,VTODO'
  components        TEXT NOT NULL DEFAULT 'VEVENT',
  read_only         INTEGER NOT NULL DEFAULT 0,
  supports_sync     INTEGER NOT NULL DEFAULT 0,
  ctag              TEXT,
  sync_token        TEXT,
  visible           INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  -- A user-set color is not overwritten by the server color on sync
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
  -- VEVENT | VTODO | VJOURNAL | INVALID (not parseable, raw text is kept)
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
  -- Local change not yet transmitted ('create' | 'update' | 'delete')
  pending_op     TEXT CHECK (pending_op IN ('create', 'update', 'delete')),
  UNIQUE (calendar_id, href)
);
CREATE INDEX IF NOT EXISTS idx_cal_objects_uid ON cal_objects(calendar_id, uid);
CREATE INDEX IF NOT EXISTS idx_cal_objects_recurring ON cal_objects(calendar_id, has_rrule);

-- Materialized occurrences. Non-recurring objects always, recurring ones
-- for a rolling window (see docs/CALDAV.md). All-day entries additionally
-- carry calendar days (start_day inclusive, end_day exclusive, 'YYYY-MM-DD').
CREATE TABLE IF NOT EXISTS cal_instances (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  object_id      INTEGER NOT NULL REFERENCES cal_objects(id) ON DELETE CASCADE,
  calendar_id    INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  -- Original occurrence start as UTC ISO ('YYYY-MM-DDTHH:mm:ssZ') or date; NULL = not recurring
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

-- Offline-first: local changes wait here for transmission. Like the
-- mail op queue: attempts are counted, then 'dead' (with reason) instead of silent deletion.
CREATE TABLE IF NOT EXISTS cal_pending_ops (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   INTEGER NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  calendar_id  INTEGER NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  object_id    INTEGER REFERENCES cal_objects(id) ON DELETE SET NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('create', 'update', 'delete')),
  href         TEXT NOT NULL,
  uid          TEXT NOT NULL,
  -- ETag the local change is based on (If-Match); NULL for 'create'
  base_etag    TEXT,
  -- On discard (conflict) the local version is kept here
  ics          TEXT,
  summary      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dead')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_pending_ops_account ON cal_pending_ops(account_id, status, id);

-- Reminders already fired (no double firing after restart)
CREATE TABLE IF NOT EXISTS cal_reminders_fired (
  object_id      INTEGER NOT NULL REFERENCES cal_objects(id) ON DELETE CASCADE,
  recurrence_id  TEXT NOT NULL DEFAULT '',
  alarm_key      TEXT NOT NULL,
  fire_at        INTEGER NOT NULL,
  fired_at       INTEGER NOT NULL,
  PRIMARY KEY (object_id, recurrence_id, alarm_key, fire_at)
);
