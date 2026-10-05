import type Database from 'better-sqlite3-multiple-ciphers'
import type { CalendarEventInput } from '@shared/calendar-types'
import type { EventSuggestionView } from '@shared/event-suggestion-types'
import { getDb } from '../db'
import { suggestCalendarId } from './invitations'
import { createEvent } from './service'
import { systemTimeZone } from './tz'

/**
 * Terminvorschläge aus Mails (2.4): Speicherung, Anzeige und Übernahme.
 * Wie bei Aufgaben-Vorschlägen gilt: nichts landet ohne Klick im Kalender.
 * Der Inhalt stammt aus Mails (unvertrauenswürdig) und wird als Klartext genutzt.
 */

/** Ergebnis der Extraktion nach Validierung/Auflösung (siehe ai/events.ts). */
export interface ResolvedEvent {
  title: string
  allDay: boolean
  /** 'YYYY-MM-DDTHH:mm:ss' bzw. 'YYYY-MM-DD' */
  startLocal: string
  /** Ganztägig exklusiv */
  endLocal: string
  tzid: string | null
  location: string | null
  link: string | null
  kind: 'proposed' | 'confirmed'
  confidence: number
}

interface SuggestionRow {
  id: number
  message_id: number
  account_id: number
  thread_key: string
  title: string
  all_day: number
  start_local: string
  end_local: string
  tzid: string | null
  location: string | null
  link: string | null
  kind: 'proposed' | 'confirmed'
  confidence: number
  state: 'new' | 'accepted' | 'dismissed'
  cal_object_id: number | null
}

/**
 * Speichert Vorschläge einer Mail. Dedupe über den Thread: derselbe Start
 * (gleicher Tag/gleiche Uhrzeit) in derselben Unterhaltung ist derselbe
 * Termin — ein bereits abgelehnter bleibt abgelehnt, ein Vorschlag wird bei
 * späterer Bestätigung zu „confirmed". Gibt die Zahl neu angelegter Zeilen zurück.
 */
export function storeEventSuggestions(
  db: Database.Database,
  ctx: { messageId: number; accountId: number; threadKey: string; model: string },
  events: ResolvedEvent[]
): number {
  const find = db.prepare(
    `SELECT id, kind FROM event_suggestions
      WHERE account_id = ? AND thread_key = ? AND start_local = ? AND all_day = ?`
  )
  const insert = db.prepare(
    `INSERT INTO event_suggestions (message_id, account_id, thread_key, title, all_day,
       start_local, end_local, tzid, location, link, kind, confidence, state, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`
  )
  let created = 0
  db.transaction(() => {
    for (const e of events) {
      const existing = find.get(ctx.accountId, ctx.threadKey, e.startLocal, e.allDay ? 1 : 0) as
        { id: number; kind: string } | undefined
      if (existing) {
        if (existing.kind === 'proposed' && e.kind === 'confirmed') {
          db.prepare(`UPDATE event_suggestions SET kind = 'confirmed' WHERE id = ?`).run(
            existing.id
          )
        }
        continue
      }
      insert.run(
        ctx.messageId,
        ctx.accountId,
        ctx.threadKey,
        e.title,
        e.allDay ? 1 : 0,
        e.startLocal,
        e.endLocal,
        e.tzid,
        e.location,
        e.link,
        e.kind,
        e.confidence,
        ctx.model,
        Date.now()
      )
      created += 1
    }
  })()
  return created
}

function toView(row: SuggestionRow, calendarId: number | null): EventSuggestionView {
  return {
    id: row.id,
    messageId: row.message_id,
    title: row.title,
    allDay: row.all_day === 1,
    startLocal: row.start_local,
    endLocal: row.end_local,
    tzid: row.tzid,
    location: row.location,
    link: row.link,
    kind: row.kind,
    confidence: row.confidence,
    state: row.state === 'accepted' ? 'accepted' : 'new',
    objectId: row.cal_object_id,
    calendarId
  }
}

/**
 * Vorschläge, die an dieser Mail hängen. Vergangene, noch offene Vorschläge
 * werden nicht mehr gezeigt; abgelehnte nie.
 */
export function listEventSuggestions(
  db: Database.Database,
  messageId: number,
  now = Date.now()
): EventSuggestionView[] {
  const rows = db
    .prepare(
      `SELECT * FROM event_suggestions WHERE message_id = ? AND state != 'dismissed' ORDER BY start_local`
    )
    .all(messageId) as SuggestionRow[]
  if (rows.length === 0) return []
  const today = localDay(now)
  const visible = rows.filter((r) => r.state === 'accepted' || r.start_local.slice(0, 10) >= today)
  if (visible.length === 0) return []
  const calendarId = suggestCalendarId(db, visible[0].account_id, null)
  return visible.map((r) => toView(r, calendarId))
}

function localDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Backend-Felder für den neuen Termin (zeitzonen- und ganztagsgenau). */
export function eventInputFromSuggestion(
  row: Pick<
    SuggestionRow,
    'title' | 'all_day' | 'start_local' | 'end_local' | 'tzid' | 'location' | 'link'
  >,
  calendarId: number,
  sourceSubject: string | null,
  zone: string = systemTimeZone()
): CalendarEventInput {
  const allDay = row.all_day === 1
  const description = [row.link, sourceSubject ? `Aus Mail: ${sourceSubject}` : null]
    .filter(Boolean)
    .join('\n')
  return {
    calendarId,
    summary: row.title,
    location: row.location,
    description: description || null,
    time: allDay
      ? {
          allDay: true,
          start: row.start_local.slice(0, 10),
          end: row.end_local.slice(0, 10),
          tzid: null
        }
      : {
          allDay: false,
          start: row.start_local.slice(0, 19),
          end: row.end_local.slice(0, 19),
          tzid: row.tzid ?? zone
        },
    rrule: null,
    status: null,
    transparency: null,
    alarms: [],
    attendees: [],
    organizer: null
  }
}

export interface AcceptDeps {
  createEvent?: typeof createEvent
}

/** „Hinzufügen": legt den Termin im Standard-Kalender an. Wirft ohne beschreibbaren Kalender. */
export function acceptEventSuggestion(
  db: Database.Database,
  id: number,
  deps: AcceptDeps = {}
): { objectId: number } {
  const row = db.prepare('SELECT * FROM event_suggestions WHERE id = ?').get(id) as
    SuggestionRow | undefined
  if (!row) throw new Error('Terminvorschlag nicht gefunden')
  if (row.state === 'accepted' && row.cal_object_id) return { objectId: row.cal_object_id }
  const calendarId = suggestCalendarId(db, row.account_id, null)
  if (calendarId === null) throw new Error('Kein Kalender mit Schreibzugriff')
  const msg = db.prepare('SELECT subject FROM messages WHERE id = ?').get(row.message_id) as
    { subject: string | null } | undefined
  const input = eventInputFromSuggestion(row, calendarId, msg?.subject ?? null)
  const { objectId } = (deps.createEvent ?? createEvent)(input, db)
  db.prepare(`UPDATE event_suggestions SET state = 'accepted', cal_object_id = ? WHERE id = ?`).run(
    objectId,
    id
  )
  return { objectId }
}

/** „Verwerfen": merkt die Ablehnung, damit der Vorschlag nicht wiederkommt. */
export function dismissEventSuggestion(db: Database.Database, id: number): void {
  db.prepare(`UPDATE event_suggestions SET state = 'dismissed' WHERE id = ?`).run(id)
}

/** „Bearbeiten…": der Editor übernimmt — der Vorschlag gilt als erledigt. */
export function markEventSuggestionEditing(db: Database.Database, id: number): void {
  db.prepare(`UPDATE event_suggestions SET state = 'accepted' WHERE id = ? AND state = 'new'`).run(
    id
  )
}

/** Gibt es in dieser Unterhaltung einen (nicht abgelehnten) Terminvorschlag? */
export function threadHasEventSuggestion(
  db: Database.Database = getDb(),
  threadKey: string
): boolean {
  return !!db
    .prepare(
      `SELECT 1 FROM event_suggestions WHERE thread_key = ? AND state != 'dismissed' LIMIT 1`
    )
    .get(threadKey)
}
