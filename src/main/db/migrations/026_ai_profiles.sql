-- Phase 1.1: AI provider profiles (endpoint + API style + local/external flag).
-- The task → profile mapping lives in the settings (ai.triageProfile,
-- ai.draftProfile, ai.sttProfile); the models stay in ai.triageModel/
-- ai.draftModel/ai.sttModel — so existing installations keep their
-- behavior. Keys live in the vault (secrets), not here.
CREATE TABLE IF NOT EXISTS ai_profiles (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  base_url    TEXT NOT NULL,
  api_style   TEXT NOT NULL DEFAULT 'chat' CHECK (api_style IN ('chat', 'responses')),
  is_local    INTEGER NOT NULL DEFAULT 0,
  preset      TEXT NOT NULL DEFAULT 'custom' CHECK (preset IN ('openrouter', 'custom')),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Built-in OpenRouter profile: upstream behavior (key stays openrouter.apiKey)
INSERT OR IGNORE INTO ai_profiles (id, name, base_url, api_style, is_local, preset, sort_order, created_at)
VALUES ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'chat', 0, 'openrouter', 0,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- Existing model settings now count as a mapping to the OpenRouter profile
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai.triageProfile', 'openrouter'),
  ('ai.draftProfile', 'openrouter'),
  ('ai.sttProfile', 'openrouter');
