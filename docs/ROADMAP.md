# Roadmap — company edition

Goal: a secure, reliable, privacy-first mail + calendar client for macOS that stays
mergeable with upstream. Company-specific behaviour is **config-driven**; upstream defaults
remain unchanged. Work lands on our branch phase by phase; upstream PRs (one per phase)
follow later.

## Decisions

| Topic            | Decision                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime          | Stay on Electron, upgrade to 44, harden (no Tauri)                                                                                                                              |
| Audit fixes      | Phase 0, before features                                                                                                                                                        |
| AI APIs          | OpenAI Chat Completions + OpenAI Responses                                                                                                                                      |
| AI config        | Provider profiles (URL, API style, optional key, local/external flag); triage, drafting, chat, dictation each choose profile + model                                            |
| Local only       | Soft switch: AI uses only profiles flagged local; update check, model catalog and embedding-model download become on-demand (no automatic requests); remote images stay blocked |
| Dictation        | macOS on-device speech (Swift helper) + optional Whisper URL (`/audio/transcriptions`)                                                                                          |
| DB at rest       | SQLCipher via `better-sqlite3-multiple-ciphers`, key in keychain (safeStorage), one-time migration with backup                                                                  |
| Distribution     | Configurable branding/bundle ID, Developer ID signing + notarization, own update feed; MDM not used but not blocked                                                             |
| Org config       | `build/org-config.json` (optional) applied at build time: app name, bundle ID, update feed, preset AI profiles, Local-only default, OAuth client IDs                            |
| Calendar servers | Generic CalDAV (RFC 4791/6764/6578) incl. Nextcloud                                                                                                                             |
| Calendar UI      | Full view: day/week/month, multi-calendar, recurrence, reminders, agenda in rail                                                                                                |
| Invites          | iMIP cards in mail (accept/tentative/decline); create meetings with attendees + free/busy; CalDAV server scheduling when supported, else iMIP via SMTP                          |
| Extras           | Owl suggests events from mail; availability-aware drafts; CardDAV contacts; tasks ↔ CalDAV VTODO                                                                                |

## Phase 0 — Audit fixes & hardening

See [AUDIT.md](AUDIT.md) for finding IDs.

- **0.1 Mail rendering**: sandboxed iframe, CSS `url()` stripping, CSP tightening, link-host
  mismatch warning, attachment filename sanitizing (SEC-1, 9, 11, 12)
- **0.2 IPC & session hardening**: settings/secrets allowlists, sender validation, max lengths,
  permission handler, header CSP, webviewTag off, dev-mode gating, SQL bind (SEC-2, 5, 7, 8, 10, 13)
- **0.3 Transport & send reliability**: enforce TLS, SMTP timeouts, outbox recovery/retry,
  MSAL loopback timeout, secret decrypt handling, log redaction (SEC-3, 14, PRV-6, 8, REL-1)
- **0.4 Sync/DB/AI-queue reliability**: atomic UIDVALIDITY reset, op dead-letter, IDLE
  watchdog/timeouts, auth-error state, migration backup + downgrade guard, AI queue recovery
  (REL-2..6) + tests (REL-8)
- **0.5 Platform**: Electron 44, dependency upgrades, fuses, entitlements, signing config,
  lint cleanup, CI gates + Dependabot (SEC-4, 6, REL-7)

## Phase 1 — AI providers, Local only, data at rest, org config

- **1.1 AI provider layer**: `LlmProvider` interface (chat, stream, json mode) with adapters
  for Chat Completions and Responses; profiles stored in DB, keys in vault; migration
  creates an "OpenRouter" profile from the existing key/models (upstream behaviour
  preserved); per-task assignment; model list per profile (`/models`), connection test;
  budget/usage only for priced profiles
- **1.2 Local only switch**: global toggle in masthead + settings; when on, only local
  profiles are usable (others greyed out, calls refused in main), update check/model
  catalog/embedding download on demand only; visible indicator
- **1.3 Dictation**: Apple on-device speech via Swift helper; Whisper-compatible endpoint
- **1.4 SQLCipher**: encrypted DB, key in safeStorage, migration of plaintext DB, 0600 perms
- **1.5 Org config & branding**: build-time config, update feed URL, signing/notarization
  pipeline docs

## Phase 2 — Calendar (CalDAV)

- **2.1 CalDAV core**: account setup (Nextcloud URL or same credentials as mail account),
  discovery, calendar list, `sync-collection` incremental sync with ctag/etag fallback,
  local schema (calendars, events, instances cache), ICS parse/serialize (`ical.js`),
  RRULE expansion, timezone handling, conflict handling via ETag `If-Match`
- **2.2 Calendar UI**: Calendar view (day/week/month), event editor, calendar colours and
  visibility, agenda in the Owl rail, reminders as macOS notifications, keyboard shortcuts
- **2.3 Invites**: parse `text/calendar` parts (REQUEST/REPLY/CANCEL/COUNTER) → inline card
  with RSVP; attendee management, free/busy (CalDAV scheduling outbox or VFREEBUSY report),
  server-side scheduling detection (`calendar-auto-schedule`), fallback iMIP via SMTP
- **2.4 AI calendar**: triage detects meeting proposals → "add to calendar" suggestion;
  drafts get free/busy context to propose slots (respects Local only)

## Phase 3 — Contacts & tasks

- **3.1 CardDAV**: address-book discovery and sync, merge into recipient autocomplete and
  attendee lookup
- **3.2 VTODO**: sync Noctua tasks with a CalDAV task list (two-way, ETag-based)

## Phase 4 — Decision models (Ollama System One)

- **4.1 Decision task**: `decision` task per profile/model (local Ollama only), typed System One
  client, capability detection (`/api/tags`, `/api/show`), decision-only models hidden from chat
  pickers, Settings → AI "Decisions" card with test, onboarding preselect/hint, org config
- **4.2 Hybrid triage**: one decision call per mail (category, priority, reply, request, meeting,
  phishing); text model only for task titles and important summaries; extractive summary otherwise
- **4.3 Gates & extras**: follow-up radar and event-suggestion gate via decision, phishing warning
  banner, mail rules with an AI condition

See [DECISIONS.md](DECISIONS.md).

## Status (2026-10-05)

All work packages of phases 0–3 are implemented on `claude/focused-cray-wxn4ps` (lint 0/0,
typecheck, ~1200 tests, production build green). Additional packages done along the way:
credential re-entry / OAuth re-auth, CalDAV discovery credential hardening, visual QA under Xvfb
with demo seeding (`scripts/demo-tour.sh`, screenshots in `docs/screenshots/company-edition/`),
2.5 attendee editing + free/busy in the editor. Nothing has been exercised on macOS or against
live servers yet — see [VERIFICATION.md](VERIFICATION.md) for the acceptance checklist.

Next candidates: replace `hunspell-asm` (nanoid advisory), Proton Bridge cert pinning, SEC-15
for chat/Owl prompts, imapflow 2 / openai 7 / msal 7 majors, CONDSTORE/QRESYNC for long-lived
inboxes, upstream PRs per phase.

Phase 4 (decision models) is implemented and unit-tested against a faked System One endpoint; it has
not been run against a real Ollama + `clef-flash` yet (checklist in [DECISIONS.md](DECISIONS.md)).

## Working mode

Implementation is done by subagents per work package (parallel where files don't overlap),
each validated with `pnpm typecheck`, `pnpm lint` (changed files), and `pnpm test:ci`
before merge into the phase branch.
