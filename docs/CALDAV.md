# CalDAV core (Phase 2.1)

Main-process backend for calendars: WebDAV/CalDAV client, local schema, sync engine,
domain service, reminders and IPC. There is no calendar view yet (2.2); Settings →
Accounts only offers account setup, connection test and calendar visibility.

## Libraries

| Library                                | Why                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ical.js` ^2 (Mozilla)                 | ICS parse/serialize, RRULE iterator, VTIMEZONE support. Zero dependencies.                                                                                                                                                                                                                                  |
| own WebDAV client (`src/main/dav/`)    | `tsdav` was not used: it pulls in several dependencies and a bundled fetch/XML stack, and we need tight control over redirects, size limits, DTD handling and credentials. The needed protocol surface (PROPFIND, REPORT, PUT, DELETE, OPTIONS, sync-collection) is small and is shared with CardDAV later. |
| own XML parser (`src/main/dav/xml.ts`) | Namespace-aware subset parser, **no DTD/DOCTYPE/ENTITY processing** (XXE and entity-expansion impossible by construction), depth/node limits. No XML dependency.                                                                                                                                            |

Time zones are computed with `Intl` (full ICU in Node/Electron), not with ical.js
timezone objects: IANA TZIDs work with or without an embedded VTIMEZONE. Unknown TZIDs fall
back to an embedded VTIMEZONE (ical.js), a Windows→IANA table, a path-prefix strip, or the
system zone.

## Layout

```
src/main/dav/          client.ts (fetch, redirects, limits, auth), xml.ts, multistatus.ts,
                       url.ts (https policy, href normalisation), caldav.ts (discovery, reports)
src/main/calendar/     tz.ts, ics.ts (read/expand), edit.ts (create/update/delete + scopes),
                       repo.ts (SQL), sync.ts (engine), service.ts (domain API),
                       accounts.ts, reminders.ts, index.ts (wiring)
src/shared/calendar-types.ts   zod schemas shared with the renderer
src/main/db/migrations/028_caldav.sql
```

## Security / transport

- Basic auth only over `https://`; `http://` is accepted only for loopback (`localhost`,
  `127.0.0.0/8`, `::1`). Checked on every request and every redirect hop.
- Redirects are handled manually (max 5): same-origin always; cross-origin only during discovery
  and only to https (credentials follow, as the user entered them for that provider). During
  sync a cross-origin redirect is an error. https→http redirects are always refused.
- Hrefs returned by the server (principal, home set, calendars, schedule URLs) pointing to a
  host unrelated to the configured one are ignored (`isRelatedHost`: same origin or same
  registrable domain, e.g. `caldav.icloud.com` → `p01-caldav.icloud.com`).
- 30 s timeout per request, 32 MB response cap, XML depth ≤ 48, ≤ 200k nodes.
- Passwords live in the vault (`cal:<accountId>:password`), never in the DB or the renderer.
- **Local only**: CalDAV servers count like mail servers — always allowed, never blocked. They
  appear in the network connection list (`kind: 'calendar'`).

## Discovery (RFC 6764)

Input may be a URL (Nextcloud base or DAV endpoint), a domain or an e-mail address. Candidate
order: explicit path → `/.well-known/caldav` → `/remote.php/dav/`, `/dav.php/` → `/`; for
domains/addresses: known-provider table (mailbox.org, Fastmail, Posteo, iCloud) →
`https://domain/.well-known/caldav` → DNS SRV `_caldavs._tcp.<domain>` (+ TXT `path=`) → `/`.
Per candidate: PROPFIND `current-user-principal` → principal props (`calendar-home-set`,
`schedule-inbox-URL`, `schedule-outbox-URL`, `calendar-user-address-set`) → PROPFIND depth 1 on
the home set (resourcetype, displayname, `calendar-color`, `calendar-order`,
`supported-calendar-component-set`, ctag, sync-token, privileges, `supported-report-set`) →
OPTIONS for the `DAV` header (`calendar-auto-schedule` → `auto_schedule`). A 401 aborts
immediately (wrong credentials). Only VEVENT/VTODO calendars are kept; schedule inbox/outbox and
trashbin are not calendars. Read-only = no write/bind privilege or subscribed calendar.

"From mail account": `calendar:accounts:suggest` returns username = mail address and the address
as server input (resolved by discovery). For password/bridge mail accounts the vault password
can be reused (`reuseMailPassword`); it is copied to the calendar account's own vault entry
(the main process never sends it to the renderer). OAuth mail accounts need an app password.

## Schema (migration 028)

| Table                 | Purpose                                                                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cal_accounts`        | server/principal/home URLs, username, optional `mail_account_id`, `schedule_inbox_url`, `schedule_outbox_url`, `user_addresses`, `auto_schedule`, `dav_capabilities`, state, last_error, last_sync |
| `calendars`           | url (absolute, trailing slash), display_name, color (+`color_user_set`), components, read_only, supports_sync, ctag, sync_token, visible, sort_order                                               |
| `cal_objects`         | href (normalised path), etag, uid, component, raw `ics`, summary, location, dtstart/dtend UTC, tzid, all_day, has_rrule, status, organizer, sequence, last_modified, `pending_op`                  |
| `cal_instances`       | materialised occurrences: recurrence_id, start/end UTC, all_day, start_day/end_day, is_override, summary/location/status. Indexes for range queries                                                |
| `cal_pending_ops`     | create/update/delete queue: base_etag, attempts, `status pending/dead`, last_error, local `ics` of discarded edits                                                                                 |
| `cal_reminders_fired` | fired alarms (object, recurrence, alarm key, fire time)                                                                                                                                            |

Instances: non-recurring objects are always materialised; recurring ones for a rolling window of
−6 / +18 months (`calendar.window` setting, advanced about monthly by `ensureInstanceWindow`,
which re-materialises recurring objects). Ranges beyond the window are expanded live by
`listEvents`. VTODOs are stored (no instances). Unparseable resources are stored as
`INVALID` so they are not refetched forever.

All-day events carry calendar days (`start_day` inclusive, `end_day` exclusive) in addition to
UTC midnight stamps; `listEvents` matches them against the viewer's local days (`tz`), so an
all-day event never shifts to the neighbouring day.

## Sync algorithm (`calendar/sync.ts`)

Per account loop (`AccountLoop`): run → idle wait (5 min ±10 %) → run. Errors back off
15 s · 2ⁿ up to 15 min with ±30 % jitter. 401 → `needs-reauth` (no retry loop; waits for a
new password or the user's refresh). Missing vault password → `needs-reauth`. System resume
wakes loops (not needs-reauth). Local edits (`kick`) and `calendar:refresh` run immediately.

One run:

1. **Push pending ops** (create/update/delete in order).
2. **Calendar list** refresh; new calendars inserted, removed ones deleted (not when the server
   returns an empty list), user colour kept.
3. **Per calendar**: skip if ctag unchanged (or, without ctag, sync-token unchanged). Otherwise:
   - `sync-collection` (RFC 6578) with the stored token; initial run with an empty token.
     507 on the collection = truncated → continue with the returned token. 403/409
     `valid-sync-token` (or 400/403 with a token) → token invalid → one retry with an empty
     token = full resync (local objects not listed are deleted).
   - If the server cannot do sync-collection (400/403/404/405/415/501) or does not advertise it:
     `calendar-query` for ETags (PROPFIND depth 1 as a last resort), diff against local ETags.
   - Changed/new hrefs are fetched with `calendar-multiget` (40 per request) and upserted.
     Objects with a pending local op are never overwritten by the read path.
     Objects with `etag = NULL` (rolled-back local edits) are refetched.
   - ctag/sync-token are stored only after the transaction succeeded.
4. `calendar:changed` is pushed with the affected calendar ids (empty = list changed).

### Local edits, conflicts, dead letters

`createEvent/updateEvent/deleteEvent` write optimistically (object + instances, immediately
visible in `listEvents`, `pending: true`) and queue an op; edits to a still-pending object are
coalesced (create stays create; create+delete vanishes). Push:

- create → `PUT` with `If-None-Match: *`; update → `PUT` with `If-Match: <base etag>`; delete →
  `DELETE` with `If-Match`. A response without ETag (server rewrote the data) triggers a GET.
- **412** → never overwritten silently: the server version is fetched and kept, the op becomes
  `dead` (`conflict`; our version stays in `cal_pending_ops.ics`), `calendar:conflict` is
  pushed. If the resource is gone on the server: `deleted-on-server`. A 412 on delete keeps the
  server version.
- 403/405/409/415 → permanent: op `dead` (`forbidden`), local state rolled back (etag cleared →
  refetch).
- Other errors count attempts; after 10 → `dead` (`attempts`), rolled back, notice pushed.
  Network and 401 errors abort the push without counting an attempt.

## Recurrence and time zones

Occurrences are computed in wall-clock time of the event's zone (ical.js `RecurIterator` on a
floating time) and converted with `Intl`, so "every Monday 09:00 Berlin" stays 09:00 across DST.
Non-existent local times (spring gap) use the offset before the transition, ambiguous times
(autumn) the first instance (RFC 5545 §3.3.5). UNTIL (UTC/date/floating), COUNT, INTERVAL,
BYxxx, RDATE, EXDATE (per TZID/UTC/date) and `RECURRENCE-ID` overrides (moved/retitled
occurrences) are supported; EXDATEs do not reduce COUNT. Floating times use the system zone at
materialisation time. `RECURRENCE-ID;RANGE=THISANDFUTURE` is not interpreted.

`recurrenceId` = original start of the occurrence: `YYYY-MM-DD` for all-day, otherwise UTC ISO
`YYYY-MM-DDTHH:mm:ssZ`.

New events with a TZID include a generated VTIMEZONE (yearly rules where the zone is regular);
existing VTIMEZONEs are preserved. Unknown properties (X-*, ATTACH, …) survive edits because
the existing components are modified, not rebuilt.

Edit scopes (`scope`, for recurring events):

- `all`: patch the master. Changing start/time or RRULE drops overrides and EXDATEs (they would
  be orphaned); other fields keep them.
- `this`: create/update a `RECURRENCE-ID` override (clone of the master without RRULE).
- `following`: split. The original gets `UNTIL` = occurrence start − 1 s (date for all-day,
  floating for floating; `COUNT` removed, remaining count moved to the new series); a new object
  (new UID) starts at the occurrence with the patch applied and takes over later overrides and
  EXDATEs (dropped when the schedule changed). On the first occurrence `following` = `all`.
- Delete: `this` → EXDATE (+ override removed), `following` → UNTIL (+ later overrides/EXDATEs
  removed), `all`/non-recurring → DELETE.

## Reminders

`reminders.ts` ticks every 30 s (and after calendar changes): for visible calendars it expands
objects containing `VALARM` for [now−1 d, now+31 d] and fires `DISPLAY`/`AUDIO` alarms
(relative to start/end, absolute; all-day relative to local midnight) as notifications via
`notifyCalendarReminder` (click → focus window, push `calendar:openEvent`). Fired alarms are
persisted (`cal_reminders_fired`), so restarts do not duplicate; alarms missed by ≤ 15 min are
caught up. Cancelled events and hidden calendars are skipped; `EMAIL` alarms are ignored.
`calendar.reminders = '0'` (main-process setting, no renderer toggle yet) disables them.
`snooze()` exists on the scheduler (in-memory only).

## IPC

Invoke: `calendar:accounts:list|suggest|discover|add|update|updatePassword|remove|test`,
`calendar:list`, `calendar:setVisible`, `calendar:setColor`, `calendar:events:list|get|create|update|delete`,
`calendar:refresh`. Push: `calendar:changed`, `calendar:accountState`, `calendar:conflict`,
`calendar:openEvent`. All inputs are zod-validated with max lengths (summary 1000, description
50 000, RRULE 500, ≤ 20 alarms, ≤ 200 attendees, password 1000, server input 500).

## Tested server behaviour (mocked)

Real servers are not reachable from CI; the tests use hand-built fixtures modelled on
Nextcloud/sabre (ctag = sync-token, relative hrefs, privileges, subscribed birthdays calendar),
Radicale (default XML namespace, quoted ctag, no privilege/report sets) and iCloud (absolute
hrefs on `pNN-caldav.icloud.com:443`, alpha colours), plus a stateful in-memory CalDAV server
for sync (sync-collection paging/invalidation, ETags, If-Match). Not exercised against live
servers: mailbox.org, Fastmail, Posteo, SOGo, Baïkal (the generic RFC 4791/6578 path applies).

## Limitations

- No VTODO two-way sync, CardDAV (VTODOs are only stored).
- Scheduling and invitations: see "Scheduling & invitations" below.
- Moving an event between calendars is not supported by `updateEvent`.
- Floating times follow the current system zone; a zone change is picked up on re-materialisation.
- Alarms further than 31 days ahead are not scheduled; reminder snooze does not survive a restart.
- Basic auth only (no OAuth for Google/Microsoft calendars).
- A server that answers an empty calendar list does not delete local calendars (guards against
  glitches); delete the account to drop them.
- Discovery by SRV needs DNS access; blocked DNS falls back to well-known.

## Scheduling & invitations (Phase 2.3)

Code: `src/main/calendar/` `itip.ts` (pure iTIP: parse, REPLY/REQUEST/CANCEL, free/busy),
`invitations.ts` (ingest, card data, RSVP), `organizer.ts` (outgoing invites + queue),
`freebusy.ts`, `identity.ts` ("me"), `mailer.ts` (iMIP texts + outbox hook); UI:
`InvitationCard.tsx` (mounted once in `EmailSheet`). Migration 031.

### Incoming (attendee side)

`parseMail` collects `text/calendar` / `application/ics` parts (and `.ics` attachments) with the
MIME `method` parameter (max 4 parts, 256 KB each). `storeBody` → `storeInvitations` parses them into
table `invitations` (one row per message part; METHOD, UID, SEQUENCE, DTSTAMP, organizer, times
resolved to UTC incl. Windows TZIDs, RRULE, RECURRENCE-ID, attendees, my address + PARTSTAT, raw ICS,
matched `cal_objects` row by UID, state). Cards show REQUEST / CANCEL / REPLY / COUNTER.

"Me" = all mail account addresses + calendar account username/`user_addresses`. The address used for
a reply is the attendee entry that matches, else the receiving mail account.

An invitation is **outdated** when the calendar copy has a higher SEQUENCE or another invitation for
the same UID/RECURRENCE-ID has a higher (SEQUENCE, DTSTAMP). Outdated cards cannot be answered.

### RSVP decision (`respondToInvitation`)

1. Event with this UID already in a calendar of an account with `calendar-auto-schedule`, we are not
   organizer and we are an ATTENDEE there → **server path**: change only our PARTSTAT in the server
   copy (existing `enqueueUpdate`, i.e. `PUT` with `If-Match` via the sync queue; for a single
   occurrence an override is created). The server sends the REPLY. **No iMIP mail.** Decline keeps
   the event with PARTSTAT=DECLINED (this is what makes the server send the reply).
2. Otherwise → **iMIP path**: accept/tentative store the event (target calendar: chosen, else first
   writable VEVENT calendar of the account matching the recipient, else `calendar.defaultCalendarId`,
   else first writable) with our PARTSTAT, `SCHEDULE-AGENT=CLIENT` on ORGANIZER (so a scheduling
   server does not also reply), VALARM/ATTACH stripped; and an iMIP REPLY goes through the outbox
   (no undo delay) from the mail account that received the invitation: `multipart/mixed` →
   `multipart/alternative` (text + `text/calendar; charset=utf-8; method=REPLY`) + `.ics` attachment
   (nodemailer `icalEvent`). REPLY contains only our ATTENDEE, DTSTAMP, SEQUENCE, UID, ORGANIZER,
   UTC DTSTART/DTEND, RECURRENCE-ID for single occurrences and the optional COMMENT.
   Decline removes an existing non-organizer copy and only sends the mail.
3. The same answer is never sent twice (state `responded` + same PARTSTAT without a new comment).

CANCEL: "remove from calendar" is only allowed when the stored organizer equals the CANCEL's
organizer and the CANCEL is not outdated.

### Replies to our events (organizer side)

REPLY mails are applied automatically — the only automatic change — if we are organizer of the
stored event, the **mail's From address equals the replying ATTENDEE**, that attendee exists in the
event and the reply's SEQUENCE is not older than the event's. Everything else is marked
`reply-ignored` (spoofing protection). Only PARTSTAT changes.

### Outgoing invitations

`createEvent/updateEvent/deleteEvent(..., { notifyAttendees })` (IPC `notifyAttendees?`, default true).
With attendees and no organizer the account's main address becomes organizer. Updates normalise
SEQUENCE (RFC 5546 §2.1.4): only schedule/status/location changes bump it; rescheduling resets the
attendees' PARTSTAT to NEEDS-ACTION.

- Account with `calendar-auto-schedule`: only the normal PUT/DELETE; the server delivers.
- Otherwise: REQUEST / CANCEL (removed attendees get a CANCEL listing only them; deleting a single
  occurrence sends a CANCEL with RECURRENCE-ID) are stored in `cal_itip_queue` and sent through the
  outbox only after the PUT/DELETE reached the server (no pending op for the UID). A dead op drops the
  queued mail; an event deleted before it was ever uploaded sends nothing.

### Free/busy

`calendar:freebusy {accountId, attendees, rangeStart, rangeEnd}` (max 50 addresses, ≤ 62 days):
own addresses come from the local DB, all others via `POST` of a VFREEBUSY REQUEST to the
schedule-outbox (headers `Originator`, `Recipient`; RFC 6638 §5), response parsed from
`schedule-response`. Servers without outbox: `source: 'unavailable'`. `calendar:freebusy:self` returns
own busy intervals (excludes CANCELLED, TRANSPARENT, events declined by me; TENTATIVE separate).

### Security

Invitation content is untrusted: size/attendee caps, description stored as capped plain text and
rendered without links, VALARM/ATTACH dropped when storing, nothing is added to a calendar without a
click. Sender checks: `senderMismatch` hint on cards, REPLY sender == ATTENDEE, CANCEL organizer ==
stored organizer. The From header itself is unauthenticated (SPF/DKIM are not evaluated here).

### Not verified against live servers

Nextcloud/sabre behaviour on attendee PARTSTAT PUT (reply delivery), decline via PARTSTAT, race
between our created copy and the server's own inbox delivery (uid conflict → dead op shown as
conflict), schedule-outbox responses of real servers, delivery/rendering of the iMIP mails in
Outlook/Gmail/Apple Mail.
