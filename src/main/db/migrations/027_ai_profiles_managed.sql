-- Phase 1.5: profiles provided by the organization (build/org-config.json).
-- managed = 1: URL, API style, local flag and name are locked, only the key
-- stays editable. Upstream installations have no such rows.
--
-- Table rebuild instead of ALTER TABLE ADD COLUMN: SQLite has no
-- "ADD COLUMN IF NOT EXISTS", and the migrations must stay repeatable like
-- the others (tests reset user_version).
CREATE TABLE ai_profiles_new (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_style   TEXT NOT NULL DEFAULT 'chat' CHECK (api_style IN ('chat', 'responses')),
  is_local    INTEGER NOT NULL DEFAULT 0,
  preset      TEXT NOT NULL DEFAULT 'custom' CHECK (preset IN ('openrouter', 'custom')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  managed     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO ai_profiles_new (id, name, base_url, api_style, is_local, preset, sort_order, created_at)
SELECT id, name, base_url, api_style, is_local, preset, sort_order, created_at FROM ai_profiles;

DROP TABLE ai_profiles;
ALTER TABLE ai_profiles_new RENAME TO ai_profiles;
