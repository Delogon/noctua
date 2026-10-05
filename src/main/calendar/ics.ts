import ICAL from 'ical.js'
import type {
  CalendarAlarm,
  CalendarAttendee,
  CalendarEventFields
} from '@shared/calendar-types'
import { resolveZone, UTC_ZONE, wallAsUtcMs, type VTimezones, type Wall, type Zone } from './tz'

/**
 * ICS lesen: Parsen (ical.js), Zeiten (TZID/UTC/floating/DATE), Felder und
 * Vorkommen (RRULE/RDATE/EXDATE/RECURRENCE-ID). Alle Berechnungen laufen über
 * Wandzeit + Zone (siehe tz.ts), damit Sommerzeit-Umstellungen stimmen.
 */

export const PRODID = '-//Noctua//CalDAV 1.0//EN'

export const DAY_MS = 24 * 3600_000

export function parseCalendar(text: string): ICAL.Component {
  const root = new ICAL.Component(ICAL.parse(text))
  if (root.name !== 'vcalendar') throw new Error('Kein VCALENDAR')
  return root
}

export function vtimezonesOf(root: ICAL.Component): VTimezones {
  const map: VTimezones = new Map()
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const id = vtz.getFirstPropertyValue('tzid')
    if (typeof id === 'string') map.set(id, vtz)
  }
  return map
}

/** Alle Komponenten eines Typs, getrennt in Stamm (ohne RECURRENCE-ID) und Ausnahmen. */
export function splitComponents(
  root: ICAL.Component,
  kind: 'vevent' | 'vtodo' = 'vevent'
): { master: ICAL.Component | null; overrides: ICAL.Component[] } {
  const all = root.getAllSubcomponents(kind)
  const master = all.find((c) => !c.hasProperty('recurrence-id')) ?? null
  const overrides = all.filter((c) => c.hasProperty('recurrence-id'))
  return { master, overrides }
}

// --- Zeitwerte --------------------------------------------------------------------

export interface TimeInfo {
  allDay: boolean
  /** 'UTC' | IANA/andere TZID | null (floating) */
  tzid: string | null
  wall: Wall
  utcMs: number
  zone: Zone
}

function isUtcTime(t: ICAL.Time): boolean {
  return t.zone === ICAL.Timezone.utcTimezone || t.zone?.tzid === 'UTC'
}

export function timeInfoFrom(
  t: ICAL.Time,
  tzidParam: string | null,
  vtz: VTimezones
): TimeInfo {
  const wall: Wall = { y: t.year, m: t.month, d: t.day, h: t.hour, mi: t.minute, s: t.second }
  if (t.isDate) {
    return {
      allDay: true,
      tzid: null,
      wall: { ...wall, h: 0, mi: 0, s: 0 },
      utcMs: Date.UTC(wall.y, wall.m - 1, wall.d),
      zone: UTC_ZONE
    }
  }
  if (isUtcTime(t)) {
    return { allDay: false, tzid: 'UTC', wall, utcMs: wallAsUtcMs(wall), zone: UTC_ZONE }
  }
  const zone = resolveZone(tzidParam, vtz)
  return { allDay: false, tzid: tzidParam, wall, utcMs: zone.wallToUtc(wall), zone }
}

export function readTime(prop: ICAL.Property | null, vtz: VTimezones): TimeInfo | null {
  if (!prop) return null
  const value = prop.getFirstValue()
  if (!(value instanceof ICAL.Time)) return null
  const tzid = prop.getParameter('tzid')
  return timeInfoFrom(value, typeof tzid === 'string' ? tzid : null, vtz)
}

export function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

export function wallToDateString(w: Wall): string {
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}`
}

export function wallToIso(w: Wall): string {
  return `${wallToDateString(w)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`
}

export function dateStringToUtcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function utcMsToDateString(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function parseWallIso(value: string): Wall {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/.exec(value)
  if (!m) throw new Error(`Ungültige Zeitangabe: ${value}`)
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    h: Number(m[4] ?? 0),
    mi: Number(m[5] ?? 0),
    s: Number(m[6] ?? 0)
  }
}

/** Kanonische Vorkommens-ID: Datum bei ganztägig, sonst UTC-ISO. */
export function recurrenceIdOf(info: TimeInfo): string {
  if (info.allDay) return wallToDateString(info.wall)
  return `${new Date(info.utcMs).toISOString().slice(0, 19)}Z`
}

export function recurrenceIdToUtcMs(rid: string): number {
  if (/^\d{4}-\d{2}-\d{2}$/.test(rid)) return dateStringToUtcMs(rid)
  const ms = Date.parse(rid)
  if (!Number.isFinite(ms)) throw new Error(`Ungültige Vorkommens-ID: ${rid}`)
  return ms
}

export interface EventTimes {
  start: TimeInfo
  endUtc: number
  /** Dauer: ms (zeitgebunden) bzw. Tage·DAY_MS (ganztägig) */
  durationMs: number
  /** Ganztägig: letzter Tag exklusiv */
  endDay: string | null
  hasExplicitEnd: boolean
}

/** Start/Ende eines VEVENT (DTEND, DURATION oder Standard). */
export function eventTimes(
  comp: ICAL.Component,
  vtz: VTimezones,
  fallbackDurationMs?: number | null
): EventTimes | null {
  const start = readTime(comp.getFirstProperty('dtstart'), vtz)
  if (!start) return null
  const dtend = readTime(comp.getFirstProperty('dtend') ?? comp.getFirstProperty('due'), vtz)
  let endUtc: number
  let explicit = true
  if (dtend) {
    endUtc = dtend.utcMs
    if (start.allDay && !dtend.allDay) endUtc = Date.UTC(dtend.wall.y, dtend.wall.m - 1, dtend.wall.d)
    if (endUtc < start.utcMs) endUtc = start.utcMs
  } else {
    const dur = comp.getFirstPropertyValue('duration')
    if (dur instanceof ICAL.Duration) {
      const secs = dur.toSeconds()
      endUtc = start.utcMs + Math.max(0, secs) * 1000
      if (start.allDay) endUtc = Math.max(endUtc, start.utcMs + DAY_MS)
    } else if (fallbackDurationMs !== undefined && fallbackDurationMs !== null) {
      endUtc = start.utcMs + fallbackDurationMs
      explicit = false
    } else {
      endUtc = start.allDay ? start.utcMs + DAY_MS : start.utcMs
      explicit = false
    }
  }
  return {
    start,
    endUtc,
    durationMs: endUtc - start.utcMs,
    endDay: start.allDay ? utcMsToDateString(endUtc) : null,
    hasExplicitEnd: explicit
  }
}

// --- Objekt-Felder (Spalten in cal_objects) -----------------------------------------

export interface ObjectFields {
  uid: string
  component: 'VEVENT' | 'VTODO' | 'VJOURNAL' | 'INVALID'
  summary: string | null
  location: string | null
  dtstartUtc: number | null
  dtendUtc: number | null
  tzid: string | null
  allDay: boolean
  hasRrule: boolean
  status: string | null
  organizer: string | null
  sequence: number
  lastModified: number | null
}

function strProp(comp: ICAL.Component, name: string): string | null {
  const v = comp.getFirstPropertyValue(name)
  return typeof v === 'string' && v !== '' ? v : null
}

export function mailtoAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const m = /^mailto:(.+)$/i.exec(value.trim())
  const addr = (m ? m[1] : value).trim()
  return addr.includes('@') ? addr.toLowerCase() : null
}

export function extractObjectFields(root: ICAL.Component): ObjectFields {
  const vtz = vtimezonesOf(root)
  const kinds = ['vevent', 'vtodo', 'vjournal'] as const
  const kind = kinds.find((k) => root.getAllSubcomponents(k).length > 0)
  if (!kind) throw new Error('Weder VEVENT noch VTODO')
  const { master, overrides } = splitComponents(root, kind === 'vjournal' ? 'vevent' : kind)
  const primary = master ?? overrides[0] ?? root.getAllSubcomponents(kind)[0]
  const uid = strProp(primary, 'uid')
  if (!uid) throw new Error('UID fehlt')
  const times = kind === 'vjournal' ? null : eventTimes(primary, vtz)
  const lm = primary.getFirstPropertyValue('last-modified') ?? primary.getFirstPropertyValue('dtstamp')
  const organizer = mailtoAddress(primary.getFirstPropertyValue('organizer'))
  const seq = Number(primary.getFirstPropertyValue('sequence') ?? 0)
  return {
    uid,
    component: kind === 'vevent' ? 'VEVENT' : kind === 'vtodo' ? 'VTODO' : 'VJOURNAL',
    summary: strProp(primary, 'summary'),
    location: strProp(primary, 'location'),
    dtstartUtc: times?.start.utcMs ?? null,
    dtendUtc: times?.endUtc ?? null,
    tzid: times?.start.tzid ?? null,
    allDay: times?.start.allDay ?? false,
    hasRrule: !!master && (master.hasProperty('rrule') || master.hasProperty('rdate')),
    status: strProp(primary, 'status')?.toUpperCase() ?? null,
    organizer,
    sequence: Number.isFinite(seq) ? seq : 0,
    lastModified: lm instanceof ICAL.Time ? timeInfoFrom(lm, null, vtz).utcMs : null
  }
}

// --- Vorkommen ----------------------------------------------------------------------

export interface Occurrence {
  recurrenceId: string | null
  startUtc: number
  endUtc: number
  allDay: boolean
  startDay: string | null
  endDay: string | null
  isOverride: boolean
  /** Komponente, deren Felder für dieses Vorkommen gelten */
  comp: ICAL.Component
}

const MAX_ITERATIONS = 20_000
const MAX_OCCURRENCES = 5_000

export interface ExpandOptions {
  windowStart: number
  windowEnd: number
  /** Zählt Vorkommen auch außerhalb des Fensters (z. B. für COUNT-Berechnung) */
  all?: boolean
}

/** UNTIL → UTC-ms-Grenze (inklusiv) bzw. Tag für Datumswerte. */
function untilLimit(
  rule: ICAL.Recur,
  start: TimeInfo
): { utcMs: number } | { day: string } | null {
  const until = rule.until
  if (!until) return null
  if (until.isDate) return { day: wallToDateString({ y: until.year, m: until.month, d: until.day, h: 0, mi: 0, s: 0 }) }
  const wall: Wall = {
    y: until.year,
    m: until.month,
    d: until.day,
    h: until.hour,
    mi: until.minute,
    s: until.second
  }
  if (isUtcTime(until)) return { utcMs: wallAsUtcMs(wall) }
  return { utcMs: start.zone.wallToUtc(wall) }
}

function occurrenceFrom(
  start: TimeInfo,
  startUtc: number,
  wall: Wall,
  durationMs: number,
  comp: ICAL.Component,
  isOverride: boolean,
  rid: string | null
): Occurrence {
  if (start.allDay) {
    const days = Math.max(1, Math.round(durationMs / DAY_MS))
    const startDay = wallToDateString(wall)
    const endUtc = startUtc + days * DAY_MS
    return {
      recurrenceId: rid,
      startUtc,
      endUtc,
      allDay: true,
      startDay,
      endDay: utcMsToDateString(endUtc),
      isOverride,
      comp
    }
  }
  return {
    recurrenceId: rid,
    startUtc,
    endUtc: startUtc + durationMs,
    allDay: false,
    startDay: null,
    endDay: null,
    isOverride,
    comp
  }
}

/** Alle EXDATE-Einträge als kanonische Vorkommens-IDs. */
export function exdatesOf(master: ICAL.Component, vtz: VTimezones): string[] {
  const out: string[] = []
  for (const prop of master.getAllProperties('exdate')) {
    const tzid = prop.getParameter('tzid')
    for (const v of prop.getValues()) {
      if (v instanceof ICAL.Time) {
        out.push(recurrenceIdOf(timeInfoFrom(v, typeof tzid === 'string' ? tzid : null, vtz)))
      }
    }
  }
  return out
}

/**
 * Vorkommen einer Ressource im Fenster [windowStart, windowEnd). Ausnahmen
 * (RECURRENCE-ID) ersetzen das generierte Vorkommen; EXDATE entfernt es.
 */
export function expandResource(root: ICAL.Component, opts: ExpandOptions): Occurrence[] {
  const vtz = vtimezonesOf(root)
  const { master, overrides } = splitComponents(root, 'vevent')
  const out: Occurrence[] = []
  const inWindow = (s: number, e: number): boolean =>
    opts.all === true || (e > opts.windowStart && s < opts.windowEnd) || (s === e && s >= opts.windowStart && s < opts.windowEnd)

  const masterTimes = master ? eventTimes(master, vtz) : null
  const recurring = !!master && (master.hasProperty('rrule') || master.hasProperty('rdate'))

  // Ausnahmen vorbereiten
  const overrideByRid = new Map<string, ICAL.Component>()
  for (const o of overrides) {
    const ridInfo = readTime(o.getFirstProperty('recurrence-id'), vtz)
    if (!ridInfo) continue
    let rid = recurrenceIdOf(ridInfo)
    // Datum vs. Datum-Zeit zwischen Stamm und Ausnahme angleichen
    if (masterTimes?.start.allDay && !ridInfo.allDay) rid = wallToDateString(ridInfo.wall)
    overrideByRid.set(rid, o)
  }

  if (master && masterTimes && !recurring) {
    const s = masterTimes.start
    if (inWindow(s.utcMs, masterTimes.endUtc)) {
      out.push(
        occurrenceFrom(s, s.utcMs, s.wall, masterTimes.durationMs, master, false, null)
      )
    }
    return out
  }

  if (master && masterTimes && recurring) {
    const start = masterTimes.start
    const exdates = new Set(exdatesOf(master, vtz))
    const generated: Array<{ wall: Wall; utc: number }> = []

    const ruleValue = master.getFirstPropertyValue('rrule')
    if (ruleValue instanceof ICAL.Recur) {
      const limit = untilLimit(ruleValue, start)
      const rule = ICAL.Recur.fromString(ruleValue.toString())
      rule.until = null
      const dtstart = ICAL.Time.fromData({
        year: start.wall.y,
        month: start.wall.m,
        day: start.wall.d,
        hour: start.wall.h,
        minute: start.wall.mi,
        second: start.wall.s,
        isDate: start.allDay
      })
      const iter = new ICAL.RecurIterator({ rule, dtstart })
      for (let i = 0; i < MAX_ITERATIONS && generated.length < MAX_OCCURRENCES; i++) {
        const t = iter.next()
        if (!t) break
        const wall: Wall = {
          y: t.year,
          m: t.month,
          d: t.day,
          h: t.hour,
          mi: t.minute,
          s: t.second
        }
        const utc = start.allDay ? Date.UTC(wall.y, wall.m - 1, wall.d) : start.zone.wallToUtc(wall)
        if (limit) {
          if ('utcMs' in limit && utc > limit.utcMs) break
          if ('day' in limit && wallToDateString(wall) > limit.day) break
        }
        if (!opts.all && utc > opts.windowEnd + 2 * DAY_MS) break
        generated.push({ wall, utc })
      }
    } else {
      generated.push({ wall: start.wall, utc: start.utcMs })
    }

    // RDATE zusätzlich
    for (const prop of master.getAllProperties('rdate')) {
      const tzid = prop.getParameter('tzid')
      for (const v of prop.getValues()) {
        const time = v instanceof ICAL.Period ? v.start : v
        if (time instanceof ICAL.Time) {
          const info = timeInfoFrom(time, typeof tzid === 'string' ? tzid : null, vtz)
          generated.push({ wall: info.wall, utc: info.utcMs })
        }
      }
    }

    const seen = new Set<number>()
    generated.sort((a, b) => a.utc - b.utc)
    for (const g of generated) {
      if (seen.has(g.utc)) continue
      seen.add(g.utc)
      const rid = start.allDay
        ? wallToDateString(g.wall)
        : `${new Date(g.utc).toISOString().slice(0, 19)}Z`
      if (exdates.has(rid)) continue
      if (overrideByRid.has(rid)) continue
      const occ = occurrenceFrom(start, g.utc, g.wall, masterTimes.durationMs, master, false, rid)
      if (inWindow(occ.startUtc, occ.endUtc)) out.push(occ)
    }
  }

  // Ausnahmen (auch ohne Stamm-Komponente: nur eingeladen zu einem Vorkommen)
  for (const [rid, o] of overrideByRid) {
    const times = eventTimes(o, vtz, masterTimes?.durationMs ?? null)
    if (!times) continue
    const s = times.start
    const occ = occurrenceFrom(s, s.utcMs, s.wall, times.durationMs, o, true, rid)
    if (inWindow(occ.startUtc, occ.endUtc)) out.push(occ)
  }

  out.sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc)
  return out
}

// --- Felder für die API --------------------------------------------------------------

function propText(comp: ICAL.Component, name: string): string | null {
  const v = comp.getFirstPropertyValue(name)
  return typeof v === 'string' && v !== '' ? v : null
}

export function readAlarms(comp: ICAL.Component): CalendarAlarm[] {
  const out: CalendarAlarm[] = []
  for (const alarm of comp.getAllSubcomponents('valarm')) {
    const action = String(alarm.getFirstPropertyValue('action') ?? 'DISPLAY').toUpperCase()
    if (action !== 'DISPLAY' && action !== 'AUDIO' && action !== 'EMAIL') continue
    const triggerProp = alarm.getFirstProperty('trigger')
    if (!triggerProp) continue
    const value = triggerProp.getFirstValue()
    const description = propText(alarm, 'description')
    if (value instanceof ICAL.Duration) {
      const related = triggerProp.getParameter('related')
      out.push({
        action,
        relativeTo: typeof related === 'string' && related.toUpperCase() === 'END' ? 'END' : 'START',
        offsetSeconds: value.toSeconds(),
        absoluteUtc: null,
        description
      })
    } else if (value instanceof ICAL.Time) {
      out.push({
        action,
        relativeTo: 'START',
        offsetSeconds: 0,
        absoluteUtc: wallAsUtcMs({
          y: value.year,
          m: value.month,
          d: value.day,
          h: value.hour,
          mi: value.minute,
          s: value.second
        }),
        description
      })
    }
  }
  return out
}

function readPerson(prop: ICAL.Property): { email: string; name: string | null } | null {
  const email = mailtoAddress(prop.getFirstValue())
  if (!email) return null
  const cn = prop.getParameter('cn')
  return { email, name: typeof cn === 'string' && cn !== '' ? cn : null }
}

export function readAttendees(comp: ICAL.Component): CalendarAttendee[] {
  const out: CalendarAttendee[] = []
  for (const prop of comp.getAllProperties('attendee')) {
    const person = readPerson(prop)
    if (!person) continue
    const param = (n: string, d: string): string => {
      const v = prop.getParameter(n)
      return typeof v === 'string' && v !== '' ? v.toUpperCase() : d
    }
    out.push({
      email: person.email,
      name: person.name,
      role: param('role', 'REQ-PARTICIPANT'),
      partstat: param('partstat', 'NEEDS-ACTION'),
      rsvp: param('rsvp', 'FALSE') === 'TRUE',
      cutype: param('cutype', 'INDIVIDUAL')
    })
  }
  return out
}

/** Felder einer Komponente für das API (Zeiten in Wandzeit der DTSTART-Zone). */
export function readFields(
  comp: ICAL.Component,
  vtz: VTimezones,
  override?: { startUtc: number; endUtc: number; allDay: boolean; zone: Zone; tzid: string | null }
): CalendarEventFields {
  const times = eventTimes(comp, vtz)
  let time: CalendarEventFields['time']
  if (override) {
    if (override.allDay) {
      time = {
        allDay: true,
        start: utcMsToDateString(override.startUtc),
        end: utcMsToDateString(override.endUtc),
        tzid: null
      }
    } else {
      time = {
        allDay: false,
        start: wallToIso(override.zone.utcToWall(override.startUtc)),
        end: wallToIso(override.zone.utcToWall(override.endUtc)),
        tzid: override.tzid
      }
    }
  } else if (times) {
    if (times.start.allDay) {
      time = {
        allDay: true,
        start: wallToDateString(times.start.wall),
        end: times.endDay ?? wallToDateString(times.start.wall),
        tzid: null
      }
    } else {
      time = {
        allDay: false,
        start: wallToIso(times.start.wall),
        end: wallToIso(times.start.zone.utcToWall(times.endUtc)),
        tzid: times.start.tzid
      }
    }
  } else {
    throw new Error('DTSTART fehlt')
  }
  const status = (propText(comp, 'status') ?? '').toUpperCase()
  const transp = (propText(comp, 'transp') ?? '').toUpperCase()
  const organizerProp = comp.getFirstProperty('organizer')
  return {
    summary: propText(comp, 'summary') ?? '',
    location: propText(comp, 'location'),
    description: propText(comp, 'description'),
    time,
    rrule: ruleString(comp),
    status: status === 'CONFIRMED' || status === 'TENTATIVE' || status === 'CANCELLED' ? status : null,
    transparency: transp === 'TRANSPARENT' ? 'TRANSPARENT' : transp === 'OPAQUE' ? 'OPAQUE' : null,
    alarms: readAlarms(comp),
    attendees: readAttendees(comp),
    organizer: organizerProp ? readPerson(organizerProp) : null
  }
}

export function ruleString(comp: ICAL.Component): string | null {
  const v = comp.getFirstPropertyValue('rrule')
  return v instanceof ICAL.Recur ? v.toString() : null
}
