-- Triage v5: model assessment of whether the account owner is meant personally.
-- Old annotations count as addressed (default 1) — existing tasks and
-- suggestions are not hidden retroactively.
ALTER TABLE ai_annotations ADD COLUMN addressed_to_me INTEGER NOT NULL DEFAULT 1;
