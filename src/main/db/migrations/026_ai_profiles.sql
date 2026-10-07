-- Phase 1.1: AI-Provider-Profile (Endpunkt + API-Stil + lokal/extern-Flag).
-- Die Zuordnung Aufgabe → Profil liegt in den Settings (ai.triageProfile,
-- ai.draftProfile, ai.sttProfile); die Modelle bleiben in ai.triageModel/
-- ai.draftModel/ai.sttModel — bestehende Installationen behalten damit ihr
-- Verhalten. Keys liegen im Vault (secrets), nicht hier.
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

-- Eingebautes OpenRouter-Profil: Upstream-Verhalten (Key bleibt openrouter.apiKey)
INSERT OR IGNORE INTO ai_profiles (id, name, base_url, api_style, is_local, preset, sort_order, created_at)
VALUES ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', 'chat', 0, 'openrouter', 0,
        CAST(strftime('%s', 'now') AS INTEGER) * 1000);

-- Bestehende Modell-Settings gelten ab jetzt als Zuordnung auf dem OpenRouter-Profil
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('ai.triageProfile', 'openrouter'),
  ('ai.draftProfile', 'openrouter'),
  ('ai.sttProfile', 'openrouter');
