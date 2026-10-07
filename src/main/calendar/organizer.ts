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
 * Organisator-Seite (RFC 5546/6638): Einladungen, Änderungen und Absagen.
 *
 * - Konto mit `calendar-auto-schedule`: nur der normale PUT/DELETE — der Server
 *   verschickt die Einladungen (iMIP/Inbox) selbst. Wir senden NICHT zusätzlich.
 * - Sonst: iMIP-Nachrichten gehen erst raus, wenn die lokale Änderung auf dem
 *   Server angekommen ist (Tabelle cal_itip_queue; Versand, sobald keine
 *   wartende cal_pending_op für die UID mehr existiert; scheitert die Op
 *   endgültig, wird nichts versendet).
 */

export interface SchedulingOptions {
  /** Teilnehmer benachrichtigen (Standard: ja, sofern Teilnehmer vorhanden und wir Organisator sind) */
  notifyAttendees?: boolean
}

function lang(): MailLang {
  return getSetting('ui.language') === 'en' ? 'en' : 'de'
}

/**
 * Hat der Termin Teilnehmer, aber keinen Organisator, wird der Nutzer
 * (Hauptadresse des Kontos) Organisator — sonst wäre es kein Meeting.
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
 * Wie `withDefaultOrganizer`, für Änderungen: Kommen Teilnehmer zu einem Termin ohne
 * Organisator hinzu, wird der Nutzer Organisator — sonst gingen keine Einladungen raus.
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
    // Absage der ganzen Ressource macht wartende Einladungen gegenstandslos
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

/** Verwirft wartende Einladungen einer UID (z. B. Termin gelöscht, bevor er je übertragen wurde). */
export function dropQueuedItip(db: Database.Database, accountId: number, uid: string): void {
  db.prepare('DELETE FROM cal_itip_queue WHERE account_id = ? AND uid = ?').run(accountId, uid)
}

export interface SchedulingPlan {
  /** Endgültiges ICS (SEQUENCE/PARTSTAT bei wesentlicher Änderung angepasst) */
  ics: string
  significant: boolean
}

/** Neuanlage: Einladung an alle Teilnehmer einreihen (nur ohne Server-Scheduling). */
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
 * Änderung: SEQUENCE sauber führen (auch mit Server-Scheduling — der Server
 * erwartet korrekte SEQUENCE) und ohne Server-Scheduling REQUEST/CANCEL einreihen.
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

/** Löschen: CANCEL an alle Teilnehmer (ganze Ressource oder einzelnes Vorkommen / dieses und folgende). */
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
 * Versendet eingereihte Nachrichten, deren Änderung auf dem Server angekommen
 * ist. Vom Sync nach jedem Push-Durchlauf aufgerufen. Gibt die Zahl der
 * versendeten Nachrichten zurück.
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
      // Änderung wurde verworfen: nichts ankündigen, was nicht passiert ist
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
      // Versand (noch) nicht möglich: Zeile bleibt für den nächsten Durchlauf
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
