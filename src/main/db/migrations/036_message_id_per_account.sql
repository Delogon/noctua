-- Thread-key lookup on ingest (computeThreadKey): `account_id = ? AND message_id IN (…)`.
-- Without this index SQLite walks idx_msg_inbox for the whole account on every reply,
-- which made ingest quadratic (≈3 ms per message at 5k, ≈66 ms at 20k).
CREATE INDEX IF NOT EXISTS idx_msg_account_msgid ON messages(account_id, message_id);
