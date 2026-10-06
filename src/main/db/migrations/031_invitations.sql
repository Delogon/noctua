-- Phase 2.3: Einladungen (iMIP/iTIP). Pro Mail-Teil mit text/calendar eine
-- geparste Zusammenfassung. Inhalt ist nicht vertrauenswürdig (kommt aus Mails):
-- nichts wird ohne Nutzeraktion in einen Kalender übernommen.
CREATE TABLE IF NOT EXISTS invitations (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id         INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  -- Index des text/calendar-Teils innerhalb der Mail (mehrere Teile möglich)
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
  -- Vorkommen, auf das sich die Einladung bezieht (NULL = ganze Serie/Einzeltermin)
  recurrence_id      TEXT,
  attendees_json     TEXT NOT NULL DEFAULT '[]',
  -- Adresse, unter der der Nutzer eingeladen ist (eigene Konto-Adresse), und deren PARTSTAT
  my_address         TEXT,
  my_partstat        TEXT,
  ics                TEXT NOT NULL,
  -- Passendes Objekt im Kalender (per UID), falls vorhanden
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

-- Einladungs-Mails des Organisators (REQUEST/CANCEL) für Konten ohne
-- serverseitiges Scheduling: werden erst versendet, wenn die lokale Änderung
-- auf dem Server angekommen ist (keine wartende cal_pending_op mehr für die UID).
CREATE TABLE IF NOT EXISTS cal_itip_queue (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id      INTEGER NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  uid             TEXT NOT NULL,
  -- request | cancel | cancel-removed (entfernte Teilnehmer)
  kind            TEXT NOT NULL CHECK (kind IN ('request', 'cancel', 'cancel-removed')),
  ics             TEXT NOT NULL,
  recipients_json TEXT NOT NULL,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  from_address    TEXT NOT NULL,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cal_itip_queue_uid ON cal_itip_queue(account_id, uid);
