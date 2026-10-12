import { createHash } from 'node:crypto'
import ICAL from 'ical.js'
import {
  parseCalendar,
  PRODID,
  readTime,
  serializeCalendar,
  vtimezonesOf,
  wallToDateString
} from '../calendar/ics'
import { resolveZone, systemTimeZone } from '../calendar/tz'

/**
 * Mapping Noctua task <-> iCalendar VTODO (RFC 5545 §3.6.2).
 *
 *   title  <-> SUMMARY
 *   notes  <-> DESCRIPTION
 *   due    <-> DUE (date 'YYYY-MM-DD'; DATE-TIME is reduced to the wall date)
 *   done   <-> STATUS:COMPLETED | COMPLETED | PERCENT-COMPLETE:100
 *
 * When writing, the existing component is always modified and only what
 * differs from the server state is touched — unknown
 * properties (X-*, ATTACH, VALARM, RRULE, PRIORITY …) are preserved.
 */

export interface TaskFields {
  title: string
  notes: string | null
  /** 'YYYY-MM-DD' or null */
  due: string | null
  done: boolean
}

export interface TodoFields extends TaskFields {
  uid: string
  /** RFC Message-ID from X-NOCTUA-MESSAGE-ID (without angle brackets) */
  messageId: string | null
}

export const MESSAGE_ID_PROP = 'x-noctua-message-id'

/** Stable UID of a locally created task (dedupe when re-enabling). */
export const taskUid = (taskId: number): string => `noctua-task-${taskId}@noctua`

/** Hash of the sync-relevant fields (line endings and edge whitespace normalized). */
export function fieldsHash(f: TaskFields): string {
  const norm = (s: string | null): string | null =>
    s === null ? null : s.replace(/\r\n?/g, '\n').trim() || null
  return createHash('sha1')
    .update(JSON.stringify([f.title.trim(), norm(f.notes), f.due, f.done]))
    .digest('hex')
}

function text(comp: ICAL.Component, name: string): string | null {
  const v = comp.getFirstPropertyValue(name)
  return typeof v === 'string' && v !== '' ? v : null
}

function todoOf(root: ICAL.Component): ICAL.Component {
  const all = root.getAllSubcomponents('vtodo')
  const master = all.find((c) => !c.hasProperty('recurrence-id')) ?? all[0]
  if (!master) throw new Error('Kein VTODO')
  return master
}

/** Due as wall date; UTC instants in the system zone, otherwise the wall date of its own zone. */
function dueDate(comp: ICAL.Component, root: ICAL.Component): string | null {
  const info = readTime(comp.getFirstProperty('due'), vtimezonesOf(root))
  if (!info) return null
  if (info.allDay) return wallToDateString(info.wall)
  if (info.tzid === 'UTC') {
    return wallToDateString(resolveZone(systemTimeZone()).utcToWall(info.utcMs))
  }
  return wallToDateString(info.wall)
}

export function readTodo(ics: string): TodoFields {
  const root = parseCalendar(ics)
  const comp = todoOf(root)
  const uid = text(comp, 'uid')
  if (!uid) throw new Error('UID fehlt')
  const status = text(comp, 'status')?.toUpperCase() ?? null
  const percent = Number(comp.getFirstPropertyValue('percent-complete') ?? 0)
  const done =
    status === 'COMPLETED' ||
    status === 'CANCELLED' ||
    comp.hasProperty('completed') ||
    percent >= 100
  const mid = text(comp, MESSAGE_ID_PROP)
  return {
    uid,
    title: text(comp, 'summary')?.trim() || '(ohne Titel)',
    notes: text(comp, 'description'),
    due: dueDate(comp, root),
    done,
    messageId: mid ? mid.replace(/^<|>$/g, '') : null
  }
}

function utcTime(ms: number): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(Math.floor(ms / 1000) * 1000), true)
}

function dateValue(day: string): ICAL.Time {
  const [y, m, d] = day.split('-').map(Number)
  return ICAL.Time.fromData({ year: y, month: m, day: d, isDate: true })
}

/** Sets the property, fully replacing its parameters (TZID/VALUE). */
function setTextProp(comp: ICAL.Component, name: string, value: string | null): void {
  comp.removeAllProperties(name)
  if (value !== null && value !== '') comp.addPropertyWithValue(name, value)
}

function applyFields(
  comp: ICAL.Component,
  next: TaskFields,
  prev: TaskFields | null,
  now: number
): void {
  if (!prev || prev.title.trim() !== next.title.trim()) setTextProp(comp, 'summary', next.title)
  if (!prev || (prev.notes ?? '') !== (next.notes ?? ''))
    setTextProp(comp, 'description', next.notes)
  if (!prev || prev.due !== next.due) {
    comp.removeAllProperties('due')
    // DURATION does not collide with DUE, but DTSTART+DURATION is kept
    if (next.due) comp.addPropertyWithValue('due', dateValue(next.due))
  }
  if (!prev || prev.done !== next.done) {
    comp.removeAllProperties('status')
    comp.removeAllProperties('completed')
    comp.removeAllProperties('percent-complete')
    if (next.done) {
      comp.addPropertyWithValue('status', 'COMPLETED')
      comp.addPropertyWithValue('completed', utcTime(now))
      comp.addPropertyWithValue('percent-complete', 100)
    } else {
      comp.addPropertyWithValue('status', 'NEEDS-ACTION')
    }
  }
  comp.updatePropertyWithValue('dtstamp', utcTime(now))
  comp.updatePropertyWithValue('last-modified', utcTime(now))
  const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0)
  comp.updatePropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1)
}

/** New VTODO object (VCALENDAR wrapper) from a task. */
export function buildTodoIcs(
  uid: string,
  fields: TaskFields,
  opts: { now: number; messageId?: string | null; created?: number }
): string {
  const root = new ICAL.Component('vcalendar')
  root.updatePropertyWithValue('version', '2.0')
  root.updatePropertyWithValue('prodid', PRODID)
  const comp = new ICAL.Component('vtodo')
  comp.updatePropertyWithValue('uid', uid)
  comp.updatePropertyWithValue('created', utcTime(opts.created ?? opts.now))
  root.addSubcomponent(comp)
  applyFields(comp, fields, null, opts.now)
  // Freshly created: start the sequence at 0
  comp.updatePropertyWithValue('sequence', 0)
  if (opts.messageId) {
    const mid = opts.messageId.replace(/^<|>$/g, '')
    comp.addPropertyWithValue(MESSAGE_ID_PROP, mid)
    // Back link as a URI (RFC 2392 mid:), so that other clients show it too
    comp.addPropertyWithValue('url', `mid:${mid}`)
  }
  return serializeCalendar(root)
}

/**
 * Changes only the fields that differ between `prev` (server state) and `next` (local),
 * and leaves everything else untouched.
 */
export function patchTodoIcs(ics: string, next: TaskFields, prev: TaskFields, now: number): string {
  const root = parseCalendar(ics)
  applyFields(todoOf(root), next, prev, now)
  return serializeCalendar(root)
}
