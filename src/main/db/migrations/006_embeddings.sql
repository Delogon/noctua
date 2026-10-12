-- Vector index for semantic search (sqlite-vec; extension is loaded on
-- DB open). rowid = messages.id, embeddings: multilingual-e5-small.
CREATE VIRTUAL TABLE message_vecs USING vec0(embedding float[384]);
