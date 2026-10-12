-- REL-5: ops are no longer silently deleted after final failure,
-- but marked 'dead' (with a reason) so they stay traceable.
ALTER TABLE op_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'dead'));
ALTER TABLE op_queue ADD COLUMN last_error TEXT;

CREATE INDEX idx_op_queue_status ON op_queue(account_id, status, id);
