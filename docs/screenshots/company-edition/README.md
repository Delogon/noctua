# Company edition screenshots

Rendered from the real app under Xvfb (Linux) with dev-only demo data, English UI unless
named `de-*`. Window 1440x900, the `4x` series 1180x760 (minimum width). Demo date is
Mon 5 Oct 2026; "now" in the calendar is the capture time.

Regenerate: `pnpm exec electron-vite build && scripts/demo-tour.sh <outdir>`
(`DEMO_PASS=local DEMO_LOCAL_ONLY=1`, `DEMO_PASS=small`, `DEMO_LANG=de`; the onboarding pass needs a
build with `NOCTUA_ORG_CONFIG=build/org-config.example.json`). See `src/main/dev/demo-seed.ts`.

| File | Shows |
| --- | --- |
| 01-inbox-newsletter, 01b | Inbox, HTML newsletter in the sandboxed iframe (inline styles, blocked remote image banner, tracking pixel removed), Owl rail with Tasks and "Today" agenda |
| 02-invitation | iMIP invitation card (accept/tentative/decline, conflict hint, calendar picker) |
| 03-link-mismatch, 03b | Mail whose link text names another host than its target; warning toast on click |
| 04-remote-images-blocked, 04b | Order mail with remote image, blocked and after "Show" (the image cannot load offline) |
| 05-mail-attachment-task | Attachment row with real size, "in your tasks" strip |
| 10-calendar-week, 11-day, 12-month | Calendar views: overlapping events, all-day and multi-day banners, recurring (with a moved occurrence), event across midnight |
| 13-quick-create | Quick-create popover on a time slot |
| 14-event-editor-attendees, 14b | Event editor with reminder, notes, attendees and partstat |
| 15-event-editor-recurring, 16-scope-choice | Recurrence editor and "only this / this and following / all" dialog |
| 17-calendar-colour-palette | Calendar sidebar with colour palette |
| 20-tasks | Tasks with CalDAV sync glyphs (synced, pending, conflict) |
| 30, 30b | Settings, Accounts: mail account, CalDAV account with calendars, address books, tasks sync list, privacy |
| 31, 31b, 31c | Settings, Intelligence: profiles (OpenRouter, local Ollama), task pickers, Local only, on-demand cards |
| 32, 32b, 32c | Under the hood: pipelines and the live network connections list (Local only off) |
| 40-45 | 1180 px window: inbox, calendar week/month/day, editor, settings |
| 50-52 | Local only ON: LOCAL ONLY badge, blocked external profile, "on request" connections |
| 60, 61 | Onboarding with organisation AI profiles (company build) |
| de-* | German UI (invitation, calendar week, accounts) |

## Known remaining visual issues

- Week view with three overlapping events in a 58-90 px column (1180 px window or open editor)
  stays cramped: blocks cascade, titles wrap mid-word.
- Event across midnight shows its start time again on the second day (month chips).
- With Local only ON and an external draft profile, the Owl says "asleep - no key" and Settings
  "no key yet" although the key exists; `ai:usage.hasApiKey` folds the Local-only block into
  "no key" (src/main/ipc/handlers.ts, left alone: AI code is being changed elsewhere).
- Raw English errors surface in Settings when offline ("fetch failed", transformers "Forbidden
  access to file ...") - expected here, the sandbox has no network.
- Date inputs in the editor follow the system locale (mm/dd/yyyy in this container).

## Console / CSP

No CSP violations in any pass. Renderer errors seen: `ai:profileModels` fetch failures (no
network, expected) and "ResizeObserver loop completed with undelivered notifications" bursts
after "Show" on remote images that cannot load (benign browser notice, sizes are stable).
