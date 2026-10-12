-- REL-5: Ops werden nach endgültigem Scheitern nicht mehr still gelöscht,
-- sondern als 'dead' markiert (mit Grund), damit sie nachvollziehbar bleiben.
ALTER TABLE op_queue ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'dead'));
ALTER TABLE op_queue ADD COLUMN last_error TEXT;

CREATE INDEX idx_op_queue_status ON op_queue(account_id, status, id);
