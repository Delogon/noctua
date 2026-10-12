-- Folder view: hierarchy delimiter per folder (from LIST) so the renderer
-- can build the tree and display names without asking the server.
ALTER TABLE folders ADD COLUMN delimiter TEXT;
