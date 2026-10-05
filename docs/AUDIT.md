# Noctua — Security, Privacy & Reliability Audit

Date: 2026-10-05 · Baseline: `0.98.0` (commit `8ad8ae8`) · Scope: whole app (main, preload,
renderer, build config, dependencies, CI). Method: manual code review + `pnpm typecheck`,
`pnpm lint`, `pnpm test:ci`, `pnpm audit`.

Baseline health: typecheck ✅ · tests ✅ (562 passed) · lint ❌ (40 errors, 203 warnings) ·
`pnpm audit --prod`: 22 high / 21 moderate.

Status column: `open` → fixed in Phase 0 unless noted (see [ROADMAP.md](ROADMAP.md)).

## Summary

The architecture is sound: sandboxed renderer with `contextIsolation`, a typed and
zod-validated IPC contract with a channel whitelist, secrets encrypted via `safeStorage`,
no `eval`/shell use, all SQL values bound, remote `<img>` blocked by default, attachments
never auto-opened, AI output never triggers actions without a user click.

The most important problems:

1. **Tracking bypass** via inline CSS `url()` in mail HTML (remote-image blocking only covers
   `<img>`), and mail HTML is rendered into the app DOM rather than an isolated frame.
2. **Opportunistic STARTTLS** for IMAP/SMTP on non-standard ports → credentials can be
   stripped to cleartext by a MITM.
3. **Generic settings/secrets IPC bridge**: a renderer compromise can rewrite OAuth client IDs,
   AI prompts, signatures and passwords.
4. **Crash-consistency gaps**: outbox rows stuck in `sending`, AI jobs stuck in `running`,
   non-atomic UIDVALIDITY reset, no DB backup before migrations.
5. **End-of-life Electron 39** and vulnerable `nodemailer` / `sharp`.
6. **Unencrypted local DB** (mail, embeddings, AI chats).

## Findings

### Security

| ID | Sev | Location | Finding | Fix |
|---|---|---|---|---|
| SEC-1 | High | `renderer/components/MailFrame.tsx:13-32`, `renderer/index.html` CSP | DOMPurify keeps inline `style`; `style="background:url(https://tracker…)"` loads (CSP `img-src https:`) without consent. Mail is injected into app DOM via `dangerouslySetInnerHTML` → `position:fixed` overlays can spoof app UI. | Render mail in a sandboxed `<iframe srcdoc sandbox>` with its own CSP (`img-src data: cid:`; `https:` only after opt-in); strip `url()`/`@import`/`position:fixed` from inline styles; drop `https:` from app-wide `img-src`. |
| SEC-2 | High | `shared/ipc-contract.ts:36-56`, `main/ipc/handlers.ts:131-143` | `settings:get/set`, `secrets:set/exists` accept any key. Renderer XSS → overwrite `google.clientId`/`ms.clientId` (OAuth redirect), AI prompts, signatures, passwords. | Allowlist of setting keys (enum/regex); OAuth client config not writable from renderer; `secrets:set` restricted to known key patterns. |
| SEC-3 | High | `main/auth/providers.ts:93`, `main/smtp/sender.ts:131-133` | IMAP: `secure` only for port 993, otherwise opportunistic STARTTLS. SMTP: `requireTLS` only for port 587. MITM can strip TLS and capture password/XOAUTH2 token. | `doSTARTTLS: true` for non-993 non-loopback IMAP; `requireTLS: true` for all non-loopback non-implicit SMTP. |
| SEC-4 | High | `package.json` | Electron 39 is end-of-life (supported: 42–44); 4 high advisories. `nodemailer` (header/recipient injection advisories), `sharp` pinned to vulnerable 0.34.5. | Upgrade Electron → 44, nodemailer, sharp, dompurify; add Dependabot + `pnpm audit` in CI. |
| SEC-5 | Medium | `main/index.ts` | No `setPermissionRequestHandler`/`CheckHandler`; CSP only via `<meta>` (no `object-src 'none'`, `base-uri`, `form-action`); `webviewTag` not explicitly off; no `will-attach-webview` guard. | Deny-by-default permission handler (allow `media` for app origin only); CSP response header; `webviewTag:false`. |
| SEC-6 | Medium | `electron-builder.yml`, `build/entitlements.mac.plist` | No Electron fuses (RunAsNode, NODE_OPTIONS, inspect, asar integrity); entitlement `allow-dyld-environment-variables` enables dylib injection; unsigned, not notarized, no hardened runtime. | `afterPack` fuses hook; drop dyld entitlement; signing + notarization config (identity via env). |
| SEC-7 | Medium | `main/ipc/register.ts:17` | IPC handlers don't validate `event.senderFrame`. | Assert sender is main window's main frame with expected URL. |
| SEC-8 | Medium | `shared/ipc-contract.ts` (various) | Some strings lack `.max()`; raw zod errors cross IPC. | Max lengths; sanitized error messages. |
| SEC-9 | Medium | `MailFrame.tsx:34-56` | Remote-image allowlist keyed on spoofable `From` address. | Key on authenticated domain (DKIM/SPF pass) or warn; drop 1×1 trackers. |
| SEC-10 | Low | `main/index.ts:30` | `NOCTUA_DEV=1` enables dev paths (env credential seeding, remote renderer URL) in packaged builds. | Honor only when `!app.isPackaged`. |
| SEC-11 | Low | `main/mail/attachments.ts:50` | Sender-controlled filename used as save-dialog default path. | `basename()` + strip separators/control chars. |
| SEC-12 | Low | `MailFrame.tsx` `openLink` | Link text ≠ href host not flagged (phishing). | Confirm dialog when displayed host differs from target host. |
| SEC-13 | Low | `main/db/repos/threads.ts:224` | `special_use` interpolated into SQL (closed union today). | Bind as parameter. |
| SEC-14 | Low | `main/auth/loopback.ts` | MSAL loopback server: no timeout; relies on MSAL for state check. | Timeout + explicit state check. |
| SEC-15 | Info | `main/ai/*` | No tool calling; AI output only becomes labels/drafts → prompt injection can bias triage/drafts but can't act. | Defense in depth: delimit mail content, "data not instructions" system text, strip invisible chars. |

### Privacy / data egress

Outbound destinations today: IMAP/SMTP servers; Google & Microsoft OAuth; `openrouter.ai`
(mail content for triage/drafts/chat, dictation audio, model catalog); `api.github.com`
update check (every 6 h, no opt-out); Hugging Face model download (~120 MB, once);
remote images (opt-in). No telemetry, crash reporting, avatars or font CDNs.

| ID | Sev | Location | Finding | Fix |
|---|---|---|---|---|
| PRV-1 | High | `main/ai/openrouter.ts` | AI hardwired to OpenRouter; no local LLM option except Apple FM for triage. | Provider profiles incl. local endpoints (Phase 1). |
| PRV-2 | Medium | `016_credential_type_google.sql:19` | `ai_enabled` defaults to 1 per account — mail goes to the AI provider as soon as a key exists. | Explicit consent step / org default. |
| PRV-3 | Medium | `main/updates.ts` | Automatic update check to GitHub (upstream repo), no setting. | Configurable feed; on-demand only in Local-only mode. |
| PRV-4 | Medium | `main/ai/embeddings.ts:28` | Automatic Hugging Face download, retried every minute on failure. | On-demand download / local path; backoff. |
| PRV-5 | Medium | `main/db/index.ts` | DB unencrypted, default umask (mail, embeddings, chats, contacts). | SQLCipher (`better-sqlite3-multiple-ciphers`), key in keychain; 0600 perms (Phase 1). |
| PRV-6 | Low | `main/ai/chat.ts:122-125`, `main/ai/style.ts:122` | Mail-derived text logged to console. | Log only in dev / redact. |
| PRV-7 | Low | `main/auth/google.ts:25`, `msal.ts` | Thunderbird's public OAuth client IDs used by default. | Org config can supply own client IDs. |
| PRV-8 | Low | `main/auth/secrets.ts` | Decrypt failure throws opaque error. | Catch → "re-enter credential" state. |
| PRV-9 | Low | `providers.ts:95` | Loopback TLS (Proton Bridge) skips verification; `tls_fingerprint256` column unused. | Trust-on-first-use pinning. |

### Reliability

| ID | Sev | Location | Finding | Fix |
|---|---|---|---|---|
| REL-1 | High | `main/smtp/outbox.ts:88-118` | Rows in `sending` never recovered after crash; no retry for transient SMTP errors; no SMTP timeouts. | Startup reconciliation → `needs-review`; stable Message-ID at enqueue; bounded retry for connection errors; timeouts. |
| REL-2 | High | `main/ai/queue.ts:84` | Jobs stuck in `running` after crash; 429/offline burn attempts; NaN budget disables cap. | Reset `running` on start; don't count transient errors; validate budget settings. |
| REL-3 | High | `main/sync/account-syncer.ts:348-362` | UIDVALIDITY reset not transactional → folder can stay empty forever after crash. | One transaction incl. new uidvalidity/cursor. |
| REL-4 | High | `main/db/migrate.ts`, `db/index.ts:22` | No backup before migrations; no downgrade guard. | `.backup()` to `noctua.sqlite.bak-v<N>` (keep 2); refuse to open newer schema. |
| REL-5 | Medium | `main/sync/engine.ts:239-310` | Ops dropped silently after 10 attempts; one poison op stalls queue; ops not bound to UIDVALIDITY; missing target folder treated as success. | Dead-letter state + user notice; skip-not-stall; uidvalidity check. |
| REL-6 | Medium | `account-syncer.ts:667-685` | IDLE: unhandled rejection, no watchdog; no per-command timeouts; auth failures retried forever. | `.catch`, inbox poll/watchdog, socket timeouts, `needs-reauth` state. |
| REL-7 | Medium | `.github/workflows/ci.yml` | No lint, audit, build or macOS job. | Add gates after lint cleanup. |
| REL-8 | Medium | tests | No tests for account-syncer, op queue, outbox recovery, AI queue. | Add with mocked ImapFlow/transport. |

## Not changing

- **Tauri migration**: evaluated and rejected — the main process depends on Node-only
  libraries (imapflow, nodemailer, better-sqlite3 + sqlite-vec, transformers.js/onnxruntime,
  msal-node); a port is a near-rewrite and would diverge from upstream. The findings above
  are app-level and would carry over.
- **MDM-enforced policies**: not needed now; config-driven design keeps the door open.
