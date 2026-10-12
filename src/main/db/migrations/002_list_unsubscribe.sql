-- Deterministic newsletter signal for the AI triage.
ALTER TABLE messages ADD COLUMN list_unsubscribe INTEGER NOT NULL DEFAULT 0;
