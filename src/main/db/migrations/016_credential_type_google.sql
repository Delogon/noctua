-- The CHECK on credential_type doesn't know 'oauth-google', and SQLite cannot
-- alter constraints afterwards → rebuild accounts using the official
-- 12-step procedure (FKs are off during migrations, see
-- migrate.ts — otherwise DROP TABLE would CASCADE-delete all mails).
-- Child tables reference "accounts" by name; after DROP + RENAME
-- their foreign keys point at the new table again.
CREATE TABLE accounts_new (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'microsoft', 'proton', 'imap')),
  credential_type TEXT NOT NULL
    CHECK (credential_type IN ('password', 'oauth-ms', 'oauth-google', 'bridge')),
  imap_host TEXT NOT NULL,
  imap_port INTEGER NOT NULL,
  smtp_host TEXT NOT NULL,
  smtp_port INTEGER NOT NULL,
  tls_fingerprint256 TEXT,              -- Cert pinning (Proton Bridge)
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  color TEXT,
  created_at INTEGER NOT NULL,
  signature TEXT,
  account_name TEXT
);

INSERT INTO accounts_new (id, email, display_name, provider, credential_type,
    imap_host, imap_port, smtp_host, smtp_port, tls_fingerprint256,
    ai_enabled, color, created_at, signature, account_name)
  SELECT id, email, display_name, provider, credential_type,
    imap_host, imap_port, smtp_host, smtp_port, tls_fingerprint256,
    ai_enabled, color, created_at, signature, account_name
  FROM accounts;

DROP TABLE accounts;
ALTER TABLE accounts_new RENAME TO accounts;

-- Index and trigger belonged to the old table and were dropped with it
CREATE UNIQUE INDEX idx_accounts_account_name_nocase
  ON accounts(lower(account_name));

CREATE TRIGGER accounts_account_name_required_insert
BEFORE INSERT ON accounts
WHEN NEW.account_name IS NULL OR trim(NEW.account_name) = ''
BEGIN
  SELECT RAISE(ABORT, 'Postfachname fehlt');
END;

CREATE TRIGGER accounts_account_name_required_update
BEFORE UPDATE OF account_name ON accounts
WHEN NEW.account_name IS NULL OR trim(NEW.account_name) = ''
BEGIN
  SELECT RAISE(ABORT, 'Postfachname fehlt');
END;
