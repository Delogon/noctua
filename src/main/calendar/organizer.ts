import type Database from 'better-sqlite3-multiple-ciphers'
import type { CalendarEventFields, CalendarEventPatch } from '@shared/calendar-types'
import { getSetting } from '../db'
import { myAddresses, mailAccountForAddress, ownAddressOf } from './identity'
import {
  attendeeAddresses,
  buildCancelIcs,
  buildOccurrenceCancelIcs,
  buildRequestIcs,
  inviteRecipients,
  normalizeSequence,
  organizerOf,
  parseItip
} from './itip'
import { inviteBody, itipSubject, sendItipMail, type MailLang, type WhenInfo } from './mailer'
import type { CalAccountRow } from './repo'

/**
 * Organizer side (RFC 5546/6638): invitations, changes and cancellations.
 *
 * - Account with `calendar-auto-schedule`: only the normal PUT/DELETE — the server
 *   sends the invitations (iMIP/inbox) itself. We do NOT send in addition.
 * - Otherwise: iMIP messages only go out once the local change has reached the
 *   server (table cal_itip_queue; sent as soon as no pending
 *   cal_pending_op exists for the UID any more; if the op fails
 *   permanently, nothing is sent).
 */

export interface SchedulingOptions {
  /** Notify attendees (default: yes, if there are attendees and we are the organizer) */
  notifyAttendees?: boolean
}

function lang(): MailLang {
  return getSetting('ui.language') === 'en' ? 'en' : 'de'
}

/**
 * If the event has attendees but no organizer, the user
 * (primary address of the account) becomes organizer — otherwise it would not be a meeting.
 */
export function withDefaultOrganizer<T extends CalendarEventFields>(
  db: Database.Database,
  account: CalAccountRow,
  fields: T
): T {
  if (fields.attendees.length === 0 || fields.organizer) return fields
  const own = ownAddressOf(db, account)
  if (!own) return fields
  return { ...fields, organizer: { email: own, name: null } }
}

/**
 * Like `withDefaultOrganizer`, for changes: if attendees are added to an event without an
 * organizer, the user becomes organizer — otherwise no invitations would go out.
 */
export function withDefaultOrganizerPatch(
  db: Database.Database,
  account: CalAccountRow,
  oldIcs: string,
  patch: CalendarEventPatch
): CalendarEventPatch {
  if (!patch.attendees || patch.attendees.length === 0 || patch.organizer !== undefined)
    return patch
  if (organizerOf(oldIcs)) return patch
  const own = ownAddressOf(db, account)
  return own ? { ...patch, organizer: { email: own, name: null } } : patch
}

export function isOrganizerMe(db: Database.Database, ics: string): boolean {
  const org = organizerOf(ics)
  return org !== null && myAddresses(db).has(org)
}

function whenOf(ics: string): { when: WhenInfo; summary: string | null; location: string | null } {
  const p = parseItip(ics, 'PUBLISH')
  return {
    when: {
      startUtc: p?.startUtc ?? null,
      endUtc: p?.endUtc ?? null,
      allDay: p?.allDay ?? false,
      tzid: p?.tzid ?? null
    },
    summary: p?.summary ?? null,
    location: p?.location ?? null
  }
}

type QueueKind = 'request' | 'cancel' | 'cancel-removed'

function enqueueItip(
  db: Database.Database,
  account: CalAccountRow,
  p: {
    uid: string
    kind: QueueKind
    ics: string
    recipients: string[]
    organizer: string
    sourceIcs: string
    update: boolean
  },
  now: number
): void {
  if (p.recipients.length === 0) return
  const info = whenOf(p.sourceIcs)
  const l = lang()
  const mailKind = p.kind === 'request' ? (p.update ? 'UPDATE' : 'REQUEST') : 'CANCEL'
  const mailAccount = mailAccountForAddress(db, p.organizer, account)
  if (!mailAccount) {
    console.warn(
      `[calendar] Keine Mail-Adresse für Organisator ${p.organizer} — Einladung wird nicht versendet`
    )
    return
  }
  const orgName = mailAccount.displayName?.trim() || p.organizer
  if (p.kind === 'request') {
    db.prepare(
      `DELETE FROM cal_itip_queue WHERE account_id = ? AND uid = ? AND kind = 'request'`
    ).run(account.id, p.uid)
  } else if (p.kind === 'cancel') {
    // Cancelling the whole resource makes pending invitations moot
    db.prepare(
      `DELETE FROM cal_itip_queue WHERE account_id = ? AND uid = ? AND kind = 'request'`
    ).run(account.id, p.uid)
  }
  db.prepare(
    `INSERT INTO cal_itip_queue (account_id, uid, kind, ics, recipients_json, subject, body, from_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    account.id,
    p.uid,
    p.kind,
    p.ics,
    JSON.stringify(p.recipients),
    itipSubject(l, mailKind, info.summary),
    inviteBody(l, {
      kind: mailKind,
      organizer: orgName,
      summary: info.summary,
      when: info.when,
      location: info.location
    }),
    p.organizer,
    now
  )
}

/** Discards pending invitations of a UID (e.g. event deleted before it was ever uploaded). */
export function dropQueuedItip(db: Database.Database, accountId: number, uid: string): void {
  db.prepare('DELETE FROM cal_itip_queue WHERE account_id = ? AND uid = ?').run(accountId, uid)
}

export interface SchedulingPlan {
  /** Final ICS (SEQUENCE/PARTSTAT adjusted on a significant change) */
  ics: string
  significant: boolean
}

/** New event: queue an invitation to all attendees (only without server scheduling). */
export function queueForCreate(
  db: Database.Database,
  account: CalAccountRow,
  uid: string,
  ics: string,
  opts: SchedulingOptions = {},
  now = Date.now()
): void {
  if (opts.notifyAttendees === false || account.auto_schedule === 1) return
  const organizer = organizerOf(ics)
  if (!organizer || !myAddresses(db).has(organizer)) return
  const recipients = inviteRecipients(ics, organizer)
  if (recipients.length === 0) return
  enqueueItip(
    db,
    account,
    {
      uid,
      kind: 'request',
      ics: buildRequestIcs(ics, now),
      recipients,
      organizer,
      sourceIcs: ics,
      update: false
    },
    now
  )
}

/**
 * Change: keep SEQUENCE correct (also with server scheduling — the server
 * expects a correct SEQUENCE) and queue REQUEST/CANCEL without server scheduling.
 */
export function planUpdate(
  db: Database.Database,
  account: CalAccountRow,
  uid: string,
  oldIcs: string,
  newIcs: string,
  opts: SchedulingOptions = {},
  now = Date.now()
): SchedulingPlan {
  const organizer = organizerOf(newIcs)
  const mine = myAddresses(db)
  const before = attendeeAddresses(oldIcs)
  const after = attendeeAddresses(newIcs)
  if (!organizer || !mine.has(organizer) || (before.size === 0 && after.size === 0)) {
    return { ics: newIcs, significant: false }
  }
  const normalized = normalizeSequence(oldIcs, newIcs, organizer)
  if (opts.notifyAttendees === false || account.auto_schedule === 1) {
    return { ics: normalized.ics, significant: normalized.significant }
  }
  const added = [...after].filter((a) => !before.has(a) && a !== organizer)
  const removed = [...before].filter((a) => !after.has(a) && a !== organizer)
  const all = inviteRecipients(normalized.ics, organizer)
  const recipients = normalized.significant ? all : all.filter((a) => added.includes(a))
  if (recipients.length > 0) {
    enqueueItip(
      db,
      account,
      {
        uid,
        kind: 'request',
        ics: buildRequestIcs(normalized.ics, now),
        recipients,
        organizer,
        sourceIcs: normalized.ics,
        update: before.size > 0 && recipients.some((r) => before.has(r))
      },
      now
    )
  }
  if (removed.length > 0) {
    enqueueItip(
      db,
      account,
      {
        uid,
        kind: 'cancel-removed',
        ics: buildCancelIcs(oldIcs, now, new Set(removed)),
        recipients: removed,
        organizer,
        sourceIcs: oldIcs,
        update: false
      },
      now
    )
  }
  return { ics: normalized.ics, significant: normalized.significant }
}

/** Delete: CANCEL to all attendees (whole resource or single occurrence / this and following). */
export function queueForDelete(
  db: Database.Database,
  account: CalAccountRow,
  uid: string,
  oldIcs: string,
  scope: { range: 'all' } | { range: 'this' | 'following'; recurrenceId: string },
  opts: SchedulingOptions = {},
  now = Date.now()
): void {
  if (opts.notifyAttendees === false || account.auto_schedule === 1) return
  const organizer = organizerOf(oldIcs)
  if (!organizer || !myAddresses(db).has(organizer)) return
  const recipients = inviteRecipients(oldIcs, organizer)
  if (recipients.length === 0) return
  const ics =
    scope.range === 'all'
      ? buildCancelIcs(oldIcs, now)
      : buildOccurrenceCancelIcs(oldIcs, scope.recurrenceId, scope.range, now)
  enqueueItip(
    db,
    account,
    {
      uid,
      kind: 'cancel',
      ics,
      recipients,
      organizer,
      sourceIcs: oldIcs,
      update: false
    },
    now
  )
}

interface QueueRow {
  id: number
  account_id: number
  uid: string
  kind: QueueKind
  ics: string
  recipients_json: string
  subject: string
  body: string
  from_address: string
  created_at: number
}

/**
 * Sends queued messages whose change has reached the server.
 * Called by the sync after each push pass. Returns the number of
 * messages sent.
 */
export function flushItipQueue(db: Database.Database, accountId: number): number {
  const rows = db
    .prepare('SELECT * FROM cal_itip_queue WHERE account_id = ? ORDER BY id')
    .all(accountId) as QueueRow[]
  let sent = 0
  for (const row of rows) {
    const pending = db
      .prepare(
        `SELECT 1 FROM cal_pending_ops WHERE account_id = ? AND uid = ? AND status = 'pending' LIMIT 1`
      )
      .get(accountId, row.uid)
    if (pending) continue
    const dead = db
      .prepare(
        `SELECT 1 FROM cal_pending_ops WHERE account_id = ? AND uid = ? AND status = 'dead'
           AND created_at >= ? LIMIT 1`
      )
      .get(accountId, row.uid, row.created_at - 5000)
    if (dead) {
      // Change was discarded: don't announce something that didn't happen
      db.prepare('DELETE FROM cal_itip_queue WHERE id = ?').run(row.id)
      continue
    }
    const account = db.prepare('SELECT * FROM cal_accounts WHERE id = ?').get(accountId) as
      CalAccountRow | undefined
    const mailAccount = mailAccountForAddress(db, row.from_address, account)
    if (!mailAccount) {
      db.prepare('DELETE FROM cal_itip_queue WHERE id = ?').run(row.id)
      continue
    }
    try {
      sendItipMail(mailAccount.id, {
        to: JSON.parse(row.recipients_json) as string[],
        subject: row.subject,
        text: row.body,
        method: row.kind === 'request' ? 'REQUEST' : 'CANCEL',
        ics: row.ics
      })
    } catch (error) {
      // Sending not possible (yet): the row stays for the next pass
      console.warn(
        `[calendar] Einladung nicht versendet: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }
    db.prepare('DELETE FROM cal_itip_queue WHERE id = ?').run(row.id)
    sent += 1
  }
  return sent
}
