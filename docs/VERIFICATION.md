# Verification checklist (macOS + live servers)

Everything on this branch was built and tested on Linux (unit/integration tests with mocks, a
fake CalDAV/CardDAV server, and screenshots under Xvfb). The items below can only be confirmed on
a real Mac and against real servers. Tick them off before the first company rollout.

## Build & platform

- [ ] `pnpm install` then `pnpm build:mac` succeeds (Apple Silicon, Xcode 26 for the Swift helper)
- [ ] `pnpm build:fm` compiles `native/fm-helper` (FoundationModels + `speech.swift`)
- [ ] Signed + notarized build with `CSC_NAME` / `APPLE_*` env vars (README → Signing & notarization)
- [ ] App launches with fuses on (`onlyLoadAppFromAsar`, asar integrity) and only `allow-jit`
      entitlement — watch semantic search (onnxruntime-node) and sqlite-vec loading
- [ ] Company build with `build/org-config.json`: name, bundle ID, own userData folder, update feed
      (github / url / off), managed AI profiles, OAuth client IDs

## Security & storage

- [ ] First start creates `noctua.dbkey` (0600) in the keychain-protected flow; DB file has no
      `SQLite format 3` header
- [ ] Upgrade from an existing plaintext upstream DB: migration to SQLCipher, `.plain-backup`
      removed after the first successful open, old `.bak-v*` removed
- [ ] Mail rendering: newsletters look right in the sandboxed iframe; remote images only after
      "Show"; link-mismatch toast
- [ ] Microphone permission prompt on first dictation; mic still works with the deny-by-default
      permission handler
- [ ] IMAP/SMTP with a server on port 143/587 requires STARTTLS (no plaintext fallback)

## AI

- [ ] OpenRouter profile works as before (triage, drafts, chat, dictation)
- [ ] Custom profile against Ollama / LM Studio (`/v1` Chat Completions) and a Responses-API server
- [ ] Whisper-compatible endpoint (`/audio/transcriptions`) for dictation
- [ ] Apple on-device dictation: `noctua-fm stt-check de-DE`, language asset install, permission
      prompt text, 2-minute German/English dictation
- [ ] Local only: no outbound requests except mail/CalDAV servers (check with Little Snitch/LuLu);
      update check, model list and search-model download only on click
- [ ] Re-run `scripts/apple-triage-eval` (triage prompt v6)

## Calendar, contacts, tasks (Nextcloud)

- [ ] Add calendar account via Nextcloud URL and via "from mail account"; calendars, colours, sync
- [ ] Create/edit/delete events incl. recurring (this / following / all), all-day, reminders
- [ ] Changes made in Nextcloud web / iOS appear in Noctua and vice versa; 412 conflict toast
- [ ] Invitation from an external organizer (Outlook, Gmail): card, Accept/Tentative/Decline,
      organizer receives exactly one reply
- [ ] Invitation sent from Nextcloud to the user (server-side scheduling): RSVP via PARTSTAT only,
      no duplicate mail
- [ ] Organizing a meeting with attendees: invitations arrive once (Nextcloud auto-schedule) and
      render correctly in Outlook / Gmail / Apple Mail; free/busy strip shows data
- [ ] CardDAV: address books listed, contacts appear in recipient autocomplete
- [ ] Tasks: pick a Nextcloud task list, accepted tasks appear there, completing in either place
      syncs
- [ ] AI: event suggestion from a mail like "Can we meet next Tuesday at 3?", reply draft proposes
      free slots
