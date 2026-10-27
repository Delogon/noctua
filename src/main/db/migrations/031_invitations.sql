-- Phase 2.3: invitations (iMIP/iTIP). One parsed summary per mail part
-- with text/calendar. Content is untrusted (comes from mails):
-- nothing goes into a calendar without user action.
CREATE TABLE IF NOT EXISTS invitations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id         INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  -- Index of the text/calendar part within the mail (multiple parts possible)
  part_index         INTEGER NOT NULL DEFAULT 0,
  uid                TEXT NOT NULL,
  -- REQUEST | CANCEL | REPLY | COUNTER | ADD | REFRESH | PUBLISH | DECLINECOUNTER
  method             TEXT NOT NULL,
  sequence           INTEGER NOT NULL DEFAULT 0,
  dtstamp            INTEGER,
  organizer          TEXT,
  organizer_name     TEXT,
  summary            TEXT,
  location           TEXT,
  description        TEXT,
  start_utc          INTEGER,
  end_utc            INTEGER,
  all_day            INTEGER NOT NULL DEFAULT 0,
  start_day          TEXT,
  end_day            TEXT,
  tzid               TEXT,
  rrule              TEXT,
  -- Occurrence the invitation refers to (NULL = whole series/single event)
  recurrence_id      TEXT,
  attendees_json     TEXT NOT NULL DEFAULT '[]',
  -- Address the user is invited under (own account address), and its PARTSTAT
  my_address         TEXT,
  my_partstat        TEXT,
  ics                TEXT NOT NULL,
  -- Matching object in the calendar (by UID), if present
  cal_object_id      INTEGER REFERENCES cal_objects(id) ON DELETE SET NULL,
  -- new | responded | removed | reply-applied | reply-ignored | ignored
  state              TEXT NOT NULL DEFAULT 'new',
  responded_partstat TEXT,
  responded_at       INTEGER,
  created_at         INTEGER NOT NULL,
  UNIQUE (message_id, part_index)
);
CREATE INDEX IF NOT EXISTS idx_invitations_uid ON invitations(uid, recurrence_id);
CREATE INDEX IF NOT EXISTS idx_invitations_object ON invitations(cal_object_id);

-- Organizer invitation mails (REQUEST/CANCEL) for accounts without
-- server-side scheduling: only sent once the local change has
-- reached the server (no pending cal_pending_op left for the UID).
CREATE TABLE IF NOT EXISTS cal_itip_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  uid             TEXT NOT NULL,
  -- request | cancel | cancel-removed (removed attendees)
  kind            TEXT NOT NULL CHECK (kind IN ('request', 'cancel', 'cancel-removed')),
  ics             TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  from_address    TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_itip_queue_uid ON cal_itip_queue(account_id, uid);
