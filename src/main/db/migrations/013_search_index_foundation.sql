-- M13: robust local search index and traceable embedding state.

-- The previous contentless FTS table could neither be updated normally nor
-- delete orphaned rows. The stored variant stays fully local but is
-- deterministically maintainable with DELETE + INSERT.
DROP TABLE IF EXISTS messages_fts;
CREATE VIRTUAL TABLE messages_fts USING fts5(
  subject, sender, recipients, body,
  tokenize = "unicode61 remove_diacritics 2",
  prefix = '2 3'
);

-- Make already loaded data searchable again right away. Envelopes
-- without a body are indexed too; attachment names become part of the full text.
INSERT INTO messages_fts (rowid, subject, sender, recipients, body)
SELECT
  m.id,
  COALESCE(m.subject, ''),
  trim(COALESCE(m.from_name, '') || ' ' || COALESCE(m.from_addr, '')),
  COALESCE(m.to_json, '') || ' ' || COALESCE(m.cc_json, ''),
  COALESCE(b.text_plain, m.snippet, '') || ' ' || COALESCE((
    SELECT group_concat(COALESCE(a.filename, ''), ' ')
    FROM attachments a
    WHERE a.message_id = m.id
  ), '')
FROM messages m
LEFT JOIN message_bodies b ON b.message_id = m.id;

-- content_hash describes the current local mail content. embedded_hash and
-- embedding_model describe exactly the vector stored in message_vecs.
-- A differing hash automatically makes the message pending again.
CREATE TABLE message_embedding_state (
  message_id INTEGER PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  embedded_hash TEXT,
  embedding_model TEXT,
  indexed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_embedding_state_current
  ON message_embedding_state(embedding_model, embedded_hash, content_hash);

-- Old vectors had neither a content hash nor a model version. A one-time
-- clean rebuild prevents a body that has since changed from being
-- treated as current.
DELETE FROM message_vecs;

-- Existing installations only had 90 days of envelopes and 30 days of bodies.
-- NULL forces the syncer into a one-time, resumable 183-day round.
ALTER TABLE folders ADD COLUMN envelope_backfill_since INTEGER;
ALTER TABLE folders ADD COLUMN body_backfill_since INTEGER;
