-- Unique, purely internal mailbox name. The visible sender name stays display_name.
ALTER TABLE accounts ADD COLUMN account_name TEXT;

UPDATE accounts
SET account_name = CASE
  WHEN lower(email) LIKE '%@googlemail.com' OR lower(email) LIKE '%@gmail.com' THEN 'Gmail'
  WHEN lower(email) LIKE '%@hotmail.%' THEN 'Hotmail'
  WHEN lower(email) LIKE '%@outlook.%' OR lower(email) LIKE '%@live.%' THEN 'Outlook'
  WHEN provider = 'proton' THEN 'Proton'
  ELSE substr(email, 1, instr(email, '@') - 1)
END;

-- If several existing accounts derive the same name, the oldest keeps the
-- short one; the others first get a unique number and can be renamed in
-- the settings.
UPDATE accounts
SET account_name = account_name || ' ' || id
WHERE id NOT IN (
  SELECT min(id) FROM accounts GROUP BY lower(account_name)
);

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
