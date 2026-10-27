-- Sync period per account: NULL = default (90 days list / 183 days search),
-- 0 = sync everything, otherwise number of days for list AND search.
ALTER TABLE accounts ADD COLUMN sync_days INTEGER;
