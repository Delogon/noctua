-- Messages that still need a vector (embedding indexer). Without it every
-- 48-row pass scanned all messages and sorted them. The model literal must
-- match EMBEDDING_MODEL (src/main/ai/embed-model.ts); a model change needs a
-- new index.
CREATE INDEX IF NOT EXISTS idx_embed_pending ON message_embedding_state(message_id)
  WHERE embedded_hash IS NULL
     OR embedded_hash != content_hash
     OR embedding_model IS NULL
     OR embedding_model != 'Xenova/multilingual-e5-base';
