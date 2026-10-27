-- When was the last nudge? Survives view switches and restarts;
-- the UI shows "NUDGED TODAY" only if the timestamp is from today.
ALTER TABLE followups ADD COLUMN nudged_at INTEGER;
