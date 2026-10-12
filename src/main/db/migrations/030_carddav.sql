-- Phase 3.1: CardDAV-Kontakte (nur lesend). Adressbücher hängen am Kalender-
-- Konto (gleicher Server/Principal, gleiches Vault-Passwort `cal:<id>:password`).
-- contacts_accounts schaltet die Kontakt-Synchronisation je Konto ein (eigene
-- Tabelle statt Spalten an cal_accounts: die Migration bleibt wiederholbar).
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
  -- [{value,type,pref}] bzw. Telefonnummern; Fotos werden nie gespeichert
  emails         TEXT NOT NULL DEFAULT '[]',
  phones         TEXT NOT NULL DEFAULT '[]',
  -- kleingeschriebener Suchtext (Name, Organisation) für Präfix-/Teilstring-Suche
  search_text    TEXT NOT NULL DEFAULT '',
  -- vCard ohne PHOTO/LOGO/SOUND/KEY, nur bis zu einer Größengrenze
  raw_vcard      TEXT,
  updated_at     INTEGER NOT NULL,
  UNIQUE (addressbook_id, href)
);
CREATE INDEX IF NOT EXISTS idx_dav_contacts_book ON dav_contacts(addressbook_id);

-- Normalisierter E-Mail-Index (lower(trim)) für schnellen Lookup/Autocomplete
CREATE TABLE IF NOT EXISTS dav_contact_emails (
  contact_id INTEGER NOT NULL REFERENCES dav_contacts(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  pref       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (contact_id, email)
);
CREATE INDEX IF NOT EXISTS idx_dav_contact_emails_email ON dav_contact_emails(email);
