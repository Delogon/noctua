-- Cache nudge drafts: generate once, show on next open.
ALTER TABLE followups ADD COLUMN nudge_draft TEXT;
