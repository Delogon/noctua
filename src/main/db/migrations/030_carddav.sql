-- Phase 3.1: CardDAV contacts (read-only). Address books belong to the calendar
-- account (same server/principal, same vault password `cal:<id>:password`).
-- contacts_accounts enables contact sync per account (separate
-- table instead of columns on cal_accounts: the migration stays repeatable).
CREATE TABLE IF NOT EXISTS contacts_accounts (
  account_id INTEGER PRIMARY KEY REFERENCES cal_accounts(id) ON DELETE CASCADE,
  enabled    INTEGER NOT NULL DEFAULT 0,
  home_url   TEXT,
  error      TEXT,
  last_sync  INTEGER
);

CREATE TABLE IF NOT EXISTS addressbooks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  ctag          TEXT,
  sync_token    TEXT,
  supports_sync INTEGER NOT NULL DEFAULT 0,
  enabled       INTEGER NOT NULL DEFAULT 1,
  last_sync     INTEGER,
  UNIQUE (account_id, url)
);
CREATE INDEX IF NOT EXISTS idx_addressbooks_account ON addressbooks(account_id);

CREATE TABLE IF NOT EXISTS dav_contacts (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  addressbook_id INTEGER NOT NULL REFERENCES addressbooks(id) ON DELETE CASCADE,
  href           TEXT NOT NULL,
  etag           TEXT,
  uid            TEXT NOT NULL,
  full_name      TEXT NOT NULL DEFAULT '',
  given_name     TEXT,
  family_name    TEXT,
  org            TEXT,
  -- [{value,type,pref}] or phone numbers; photos are never stored
  emails         TEXT NOT NULL DEFAULT '[]',
  phones         TEXT NOT NULL DEFAULT '[]',
  -- lowercased search text (name, organization) for prefix/substring search
  search_text    TEXT NOT NULL DEFAULT '',
  -- vCard without PHOTO/LOGO/SOUND/KEY, only up to a size limit
  raw_vcard      TEXT,
  updated_at     INTEGER NOT NULL,
  UNIQUE (addressbook_id, href)
);
CREATE INDEX IF NOT EXISTS idx_dav_contacts_book ON dav_contacts(addressbook_id);

-- Normalized email index (lower(trim)) for fast lookup/autocomplete
CREATE TABLE IF NOT EXISTS dav_contact_emails (
  contact_id INTEGER NOT NULL REFERENCES dav_contacts(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  pref       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contact_id, email)
);
CREATE INDEX IF NOT EXISTS idx_dav_contact_emails_email ON dav_contact_emails(email);
