import { randomUUID } from 'node:crypto'
import ICAL from 'ical.js'
import type {
  CalendarAlarm,
  CalendarAttendee,
  CalendarEditScope,
  CalendarEventFields,
  CalendarEventPatch
} from '@shared/calendar-types'
import {
  DAY_MS,
  eventTimes,
  expandResource,
  parseCalendar,
  parseWallIso,
  PRODID,
  recurrenceIdOf,
  recurrenceIdToUtcMs,
  serializeCalendar,
  splitComponents,
  timeInfoFrom,
  utcMsToDateString,
  vtimezonesOf,
  wallToDateString,
  type TimeInfo
} from './ics'
import { buildVTimezone, isValidIana, type Wall } from './tz'

/**
 * ICS schreiben: neue Ereignisse, Änderungen und Löschungen mit Geltungsbereich
 * (dieses Vorkommen / dieses und folgende / alle). Es wird immer die
 * vorhandene Komponente verändert (nicht neu erzeugt), damit unbekannte
 * Properties (X-*, ATTACH, …) erhalten bleiben.
 */

export interface EditContext {
  now: number
  newUid: () => string
}

export const defaultEditContext = (): EditContext => ({
  now: Date.now(),
  newUid: () => `${randomUUID()}@noctua`
})

// --- Bausteine -----------------------------------------------------------------------

function utcTime(ms: number): ICAL.Time {
  return ICAL.Time.fromJSDate(new Date(Math.floor(ms / 1000) * 1000), true)
}

function timeValue(allDay: boolean, wall: Wall, tzid: string | null): ICAL.Time {
  if (allDay) {
    return ICAL.Time.fromData({
      year: wall.y,
      month: wall.m,
      day: wall.d,
      isDate: true
    })
  }
  const zone = tzid === 'UTC' ? ICAL.Timezone.utcTimezone : undefined
  return ICAL.Time.fromData(
    { year: wall.y, month: wall.m, day: wall.d, hour: wall.h, minute: wall.mi, second: wall.s },
    zone
  )
}

export function makeTimeProp(
  name: string,
  allDay: boolean,
  wall: Wall,
  tzid: string | null
): ICAL.Property {
  const prop = new ICAL.Property(name)
  if (allDay) prop.resetType('date')
  prop.setValue(timeValue(allDay, wall, tzid))
  if (!allDay && tzid && tzid !== 'UTC') prop.setParameter('tzid', tzid)
  return prop
}

function stampNow(comp: ICAL.Component, ctx: EditContext, bumpSequence: boolean): void {
  comp.updatePropertyWithValue('dtstamp', utcTime(ctx.now))
  comp.updatePropertyWithValue('last-modified', utcTime(ctx.now))
  if (bumpSequence) {
    const seq = Number(comp.getFirstPropertyValue('sequence') ?? 0)
    comp.updatePropertyWithValue('sequence', (Number.isFinite(seq) ? seq : 0) + 1)
  }
}

export function ensureVTimezone(root: ICAL.Component, tzid: string | null, year: number): void {
  if (!tzid || tzid === 'UTC' || !isValidIana(tzid)) return
  if (vtimezonesOf(root).has(tzid)) return
  root.addSubcomponent(buildVTimezone(tzid, year))
}

function setOrRemove(comp: ICAL.Component, name: string, value: string | null): void {
  if (value === null || value === '') comp.removeAllProperties(name)
  else comp.updatePropertyWithValue(name, value)
}

function mailto(email: string): string {
  return `mailto:${email.trim()}`
}

function writeAlarms(comp: ICAL.Component, alarms: CalendarAlarm[], summary: string): void {
  comp.removeAllSubcomponents('valarm')
  for (const a of alarms) {
    const alarm = new ICAL.Component('valarm')
    alarm.addPropertyWithValue('action', a.action)
    const trigger = new ICAL.Property('trigger')
    if (a.absoluteUtc !== null) {
      trigger.resetType('date-time')
      trigger.setValue(utcTime(a.absoluteUtc))
    } else {
      trigger.setValue(ICAL.Duration.fromSeconds(a.offsetSeconds))
      if (a.relativeTo === 'END') trigger.setParameter('related', 'END')
    }
    alarm.addProperty(trigger)
    if (a.action === 'DISPLAY' || a.action === 'EMAIL') {
      alarm.addPropertyWithValue('description', a.description || summary || 'Reminder')
    }
    if (a.action === 'EMAIL') alarm.addPropertyWithValue('summary', summary || 'Reminder')
    comp.addSubcomponent(alarm)
  }
}

function writeAttendees(comp: ICAL.Component, attendees: CalendarAttendee[]): void {
  comp.removeAllProperties('attendee')
  for (const a of attendees) {
    const prop = new ICAL.Property('attendee')
    prop.setValue(mailto(a.email))
    if (a.name) prop.setParameter('cn', a.name)
    prop.setParameter('role', a.role)
    prop.setParameter('partstat', a.partstat)
    prop.setParameter('cutype', a.cutype)
    if (a.rsvp) prop.setParameter('rsvp', 'TRUE')
    comp.addProperty(prop)
  }
}

function parseRule(value: string): ICAL.Recur {
  let rule: ICAL.Recur
  try {
    rule = ICAL.Recur.fromString(value.replace(/^RRULE:/i, ''))
  } catch {
    throw new Error('Ungültige Wiederholungsregel')
  }
  if (!rule.freq) throw new Error('Ungültige Wiederholungsregel (FREQ fehlt)')
  return rule
}

/** Setzt DTSTART/DTEND aus der editierbaren Zeitangabe. */
function writeTime(
  comp: ICAL.Component,
  root: ICAL.Component,
  time: CalendarEventFields['time']
): void {
  const start = parseWallIso(time.start)
  const end = parseWallIso(time.end)
  const startMs = Date.UTC(start.y, start.m - 1, start.d, start.h, start.mi, start.s)
  const endMs = Date.UTC(end.y, end.m - 1, end.d, end.h, end.mi, end.s)
  if (endMs < startMs) throw new Error('Das Ende liegt vor dem Beginn')
  const tzid = time.allDay ? null : time.tzid
  comp.removeAllProperties('dtstart')
  comp.removeAllProperties('dtend')
  comp.removeAllProperties('duration')
  comp.removeAllProperties('due')
  comp.addProperty(makeTimeProp('dtstart', time.allDay, start, tzid))
  if (time.allDay) {
    // Ganztägig: Ende exklusiv, mindestens ein Tag
    const e = endMs <= startMs ? new Date(startMs + DAY_MS) : new Date(endMs)
    const endWall: Wall = {
      y: e.getUTCFullYear(),
      m: e.getUTCMonth() + 1,
      d: e.getUTCDate(),
      h: 0,
      mi: 0,
      s: 0
    }
    comp.addProperty(makeTimeProp('dtend', true, endWall, null))
  } else {
    comp.addProperty(makeTimeProp('dtend', false, end, tzid))
  }
  ensureVTimezone(root, tzid, start.y)
}

function applyFields(
  comp: ICAL.Component,
  root: ICAL.Component,
  patch: CalendarEventPatch,
  opts: { allowRule: boolean }
): void {
  if (patch.summary !== undefined) comp.updatePropertyWithValue('summary', patch.summary)
  if (patch.location !== undefined) setOrRemove(comp, 'location', patch.location)
  if (patch.description !== undefined) setOrRemove(comp, 'description', patch.description)
  if (patch.time !== undefined) writeTime(comp, root, patch.time)
  if (patch.rrule !== undefined && opts.allowRule) {
    comp.removeAllProperties('rrule')
    if (patch.rrule) comp.addPropertyWithValue('rrule', parseRule(patch.rrule))
  }
  if (patch.status !== undefined) setOrRemove(comp, 'status', patch.status)
  if (patch.transparency !== undefined) setOrRemove(comp, 'transp', patch.transparency)
  if (patch.attendees !== undefined) writeAttendees(comp, patch.attendees)
  if (patch.organizer !== undefined) {
    comp.removeAllProperties('organizer')
    if (patch.organizer) {
      const prop = new ICAL.Property('organizer')
      prop.setValue(mailto(patch.organizer.email))
      if (patch.organizer.name) prop.setParameter('cn', patch.organizer.name)
      comp.addProperty(prop)
    }
  }
  if (patch.alarms !== undefined) {
    writeAlarms(comp, patch.alarms, String(comp.getFirstPropertyValue('summary') ?? ''))
  }
}

// --- Neu anlegen -----------------------------------------------------------------------

export function createEventIcs(
  fields: CalendarEventFields,
  ctx: EditContext = defaultEditContext()
): { ics: string; uid: string } {
  const root = new ICAL.Component(['vcalendar', [], []])
  root.addPropertyWithValue('version', '2.0')
  root.addPropertyWithValue('prodid', PRODID)
  const ev = new ICAL.Component('vevent')
  const uid = ctx.newUid()
  ev.addPropertyWithValue('uid', uid)
  ev.addPropertyWithValue('created', utcTime(ctx.now))
  ev.addPropertyWithValue('sequence', 0)
  stampNow(ev, ctx, false)
  root.addSubcomponent(ev)
  applyFields(ev, root, fields, { allowRule: true })
  return { ics: serializeCalendar(root), uid }
}

// --- Ändern ----------------------------------------------------------------------------

export interface UpdateArgs {
  scope: CalendarEditScope
  /** Kanonische Vorkommens-ID (bei this/following), sonst null */
  recurrenceId: string | null
  patch: CalendarEventPatch
}

export interface UpdateResult {
  /** Neue Fassung der bestehenden Ressource */
  ics: string
  /** Bei „dieses und folgende": neue Ressource für die abgespaltene Serie */
  created: { ics: string; uid: string } | null
}

function clone(comp: ICAL.Component): ICAL.Component {
  // toJSON liefert die interne Struktur — tief kopieren, sonst teilen sich Klone ihre Properties
  return new ICAL.Component(JSON.parse(JSON.stringify(comp.toJSON())))
}

function ridProp(name: string, rid: string, start: TimeInfo): ICAL.Property {
  if (start.allDay) {
    const [y, m, d] = rid.slice(0, 10).split('-').map(Number)
    return makeTimeProp(name, true, { y, m, d, h: 0, mi: 0, s: 0 }, null)
  }
  const wall = start.zone.utcToWall(recurrenceIdToUtcMs(rid))
  return makeTimeProp(name, false, wall, start.tzid)
}

function patchTouchesSchedule(
  patch: CalendarEventPatch,
  master: ICAL.Component,
  vtz: ReturnType<typeof vtimezonesOf>
): boolean {
  if (patch.rrule !== undefined) {
    const current = master.getFirstPropertyValue('rrule')
    const cur = current instanceof ICAL.Recur ? current.toString() : null
    const next = patch.rrule ? parseRule(patch.rrule).toString() : null
    if (cur !== next) return true
  }
  if (patch.time !== undefined) {
    const t = eventTimes(master, vtz)
    if (!t) return true
    const wallS = t.start.allDay ? wallToDateString(t.start.wall) : isoWall(t.start)
    if (patch.time.allDay !== t.start.allDay || patch.time.start !== wallS) return true
    if (!t.start.allDay && (patch.time.tzid ?? null) !== t.start.tzid) return true
  }
  return false
}

function isoWall(info: TimeInfo): string {
  const w = info.wall
  const p = (n: number, l = 2): string => String(n).padStart(l, '0')
  return `${p(w.y, 4)}-${p(w.m)}-${p(w.d)}T${p(w.h)}:${p(w.mi)}:${p(w.s)}`
}

function setUntil(comp: ICAL.Component, start: TimeInfo, beforeUtc: number): ICAL.Recur {
  const value = comp.getFirstPropertyValue('rrule')
  if (!(value instanceof ICAL.Recur)) throw new Error('Keine Wiederholungsregel')
  const rule = ICAL.Recur.fromString(value.toString())
  rule.count = null
  if (start.allDay) {
    rule.until = ICAL.Time.fromData({
      ...datePart(utcMsToDateString(beforeUtc - DAY_MS)),
      isDate: true
    })
  } else if (start.tzid === null) {
    // floating
    const w = start.zone.utcToWall(beforeUtc - 1000)
    rule.until = ICAL.Time.fromData({
      year: w.y,
      month: w.m,
      day: w.d,
      hour: w.h,
      minute: w.mi,
      second: w.s
    })
  } else {
    rule.until = utcTime(beforeUtc - 1000)
  }
  comp.removeAllProperties('rrule')
  comp.addPropertyWithValue('rrule', rule)
  return rule
}

function datePart(day: string): { year: number; month: number; day: number } {
  const [y, m, d] = day.split('-').map(Number)
  return { year: y, month: m, day: d }
}

function removeExdatesFrom(
  comp: ICAL.Component,
  vtz: ReturnType<typeof vtimezonesOf>,
  fromUtc: number,
  keepBefore: boolean
): void {
  const props = comp.getAllProperties('exdate')
  const kept: Array<{ prop: ICAL.Property; times: ICAL.Time[] }> = []
  for (const prop of props) {
    const tzid = prop.getParameter('tzid')
    const times: ICAL.Time[] = []
    for (const v of prop.getValues()) {
      if (!(v instanceof ICAL.Time)) continue
      const info = timeInfoOf(v, typeof tzid === 'string' ? tzid : null, vtz)
      const before = info < fromUtc
      if (before === keepBefore) times.push(v)
    }
    kept.push({ prop, times })
  }
  for (const { prop, times } of kept) {
    if (times.length === 0) comp.removeProperty(prop)
    else prop.setValues(times)
  }
}

function timeInfoOf(
  v: ICAL.Time,
  tzid: string | null,
  vtz: ReturnType<typeof vtimezonesOf>
): number {
  return recurrenceIdToUtcMs(recurrenceIdOf(timeInfoFrom(v, tzid, vtz)))
}

function assertOccurrence(root: ICAL.Component, rid: string): void {
  const ms = recurrenceIdToUtcMs(rid)
  const found = expandResource(root, {
    windowStart: ms - DAY_MS,
    windowEnd: ms + 3 * DAY_MS
  }).some((o) => o.recurrenceId === rid)
  if (!found) throw new Error('Vorkommen nicht gefunden')
}

function findOverride(root: ICAL.Component, rid: string): ICAL.Component | null {
  const vtz = vtimezonesOf(root)
  const { overrides } = splitComponents(root, 'vevent')
  for (const o of overrides) {
    const prop = o.getFirstProperty('recurrence-id')
    const value = prop?.getFirstValue()
    if (!(value instanceof ICAL.Time)) continue
    const tzid = prop?.getParameter('tzid')
    const info = timeInfoFrom(value, typeof tzid === 'string' ? tzid : null, vtz)
    const key = info.allDay ? wallToDateString(info.wall) : recurrenceIdOf(info)
    if (key === rid || key.slice(0, 10) === rid) return o
  }
  return null
}

export function updateIcs(
  ics: string,
  args: UpdateArgs,
  ctx: EditContext = defaultEditContext()
): UpdateResult {
  const root = parseCalendar(ics)
  const vtz = vtimezonesOf(root)
  const { master, overrides } = splitComponents(root, 'vevent')
  const recurring = !!master && (master.hasProperty('rrule') || master.hasProperty('rdate'))
  const { patch } = args

  // Nur Ausnahmen ohne Stamm / nicht wiederkehrend / „alle"
  if (!master) {
    const target = (args.recurrenceId && findOverride(root, args.recurrenceId)) || overrides[0]
    if (!target) throw new Error('Kein Ereignis gefunden')
    applyFields(target, root, patch, { allowRule: false })
    stampNow(target, ctx, true)
    return { ics: serializeCalendar(root), created: null }
  }

  const rid = args.recurrenceId
  const masterTimes = eventTimes(master, vtz)
  if (!masterTimes) throw new Error('DTSTART fehlt')
  const firstRid = recurrenceIdOf(masterTimes.start)
  const scope: CalendarEditScope =
    !recurring || rid === null
      ? 'all'
      : args.scope === 'following' && rid === firstRid
        ? 'all'
        : args.scope

  if (scope === 'all') {
    const schedule = recurring && patchTouchesSchedule(patch, master, vtz)
    applyFields(master, root, patch, { allowRule: true })
    if (schedule) {
      // Zeit/Regel der Serie geändert: Ausnahmen und EXDATEs würden verwaisen
      for (const o of overrides) root.removeSubcomponent(o)
      master.removeAllProperties('exdate')
    }
    stampNow(master, ctx, true)
    return { ics: serializeCalendar(root), created: null }
  }

  if (rid === null) throw new Error('Vorkommens-ID fehlt')
  assertOccurrence(root, rid)

  if (scope === 'this') {
    const existing = findOverride(root, rid)
    if (existing) {
      applyFields(existing, root, patch, { allowRule: false })
      stampNow(existing, ctx, true)
      return { ics: serializeCalendar(root), created: null }
    }
    const ov = clone(master)
    ov.removeAllProperties('rrule')
    ov.removeAllProperties('rdate')
    ov.removeAllProperties('exdate')
    ov.removeAllProperties('recurrence-id')
    // Zeiten dieses Vorkommens
    const startUtc = recurrenceIdToUtcMs(rid)
    const startWall = masterTimes.start.allDay
      ? { ...datePartWall(rid) }
      : masterTimes.start.zone.utcToWall(startUtc)
    const endUtc = startUtc + masterTimes.durationMs
    const endWall = masterTimes.start.allDay
      ? { ...datePartWall(utcMsToDateString(endUtc)) }
      : masterTimes.start.zone.utcToWall(endUtc)
    ov.removeAllProperties('dtstart')
    ov.removeAllProperties('dtend')
    ov.removeAllProperties('duration')
    ov.addProperty(
      makeTimeProp('dtstart', masterTimes.start.allDay, startWall, masterTimes.start.tzid)
    )
    ov.addProperty(makeTimeProp('dtend', masterTimes.start.allDay, endWall, masterTimes.start.tzid))
    ov.addProperty(ridProp('recurrence-id', rid, masterTimes.start))
    ov.updatePropertyWithValue('sequence', 0)
    applyFields(ov, root, patch, { allowRule: false })
    stampNow(ov, ctx, false)
    root.addSubcomponent(ov)
    return { ics: serializeCalendar(root), created: null }
  }

  // following: Serie teilen
  const splitUtc = recurrenceIdToUtcMs(rid)
  const origRule = master.getFirstPropertyValue('rrule')
  if (!(origRule instanceof ICAL.Recur)) throw new Error('Keine Wiederholungsregel')

  // COUNT: Rest der Serie ab dem Teilungspunkt
  let remaining: number | null = null
  if (origRule.count) {
    const tmp = new ICAL.Component(['vcalendar', [], []])
    for (const v of root.getAllSubcomponents('vtimezone')) tmp.addSubcomponent(clone(v))
    const m = clone(master)
    m.removeAllProperties('exdate')
    tmp.addSubcomponent(m)
    const before = expandResource(tmp, { windowStart: 0, windowEnd: 0, all: true }).filter(
      (o) => o.startUtc < splitUtc
    ).length
    remaining = origRule.count - before
    if (remaining < 1) remaining = 1
  }

  // Neue Serie aus Klon des Stamms
  const newRoot = new ICAL.Component(['vcalendar', [], []])
  newRoot.addPropertyWithValue('version', '2.0')
  newRoot.addPropertyWithValue('prodid', PRODID)
  for (const v of root.getAllSubcomponents('vtimezone')) newRoot.addSubcomponent(clone(v))
  const fresh = clone(master)
  const newUid = ctx.newUid()
  fresh.updatePropertyWithValue('uid', newUid)
  fresh.removeAllProperties('recurrence-id')
  fresh.updatePropertyWithValue('sequence', 0)
  fresh.updatePropertyWithValue('created', utcTime(ctx.now))
  // DTSTART/DTEND auf das Vorkommen verschieben
  const startWall = masterTimes.start.allDay
    ? datePartWall(rid)
    : masterTimes.start.zone.utcToWall(splitUtc)
  const endUtc = splitUtc + masterTimes.durationMs
  const endWall = masterTimes.start.allDay
    ? datePartWall(utcMsToDateString(endUtc))
    : masterTimes.start.zone.utcToWall(endUtc)
  fresh.removeAllProperties('dtstart')
  fresh.removeAllProperties('dtend')
  fresh.removeAllProperties('duration')
  fresh.addProperty(
    makeTimeProp('dtstart', masterTimes.start.allDay, startWall, masterTimes.start.tzid)
  )
  fresh.addProperty(
    makeTimeProp('dtend', masterTimes.start.allDay, endWall, masterTimes.start.tzid)
  )
  if (remaining !== null) {
    const rule = ICAL.Recur.fromString(origRule.toString())
    rule.count = remaining
    fresh.removeAllProperties('rrule')
    fresh.addPropertyWithValue('rrule', rule)
  }
  const shifts = patchTouchesSchedule(patch, fresh, vtz) || patch.time !== undefined
  removeExdatesFrom(fresh, vtz, splitUtc, false)
  applyFields(fresh, newRoot, patch, { allowRule: true })
  if (shifts) fresh.removeAllProperties('exdate')
  stampNow(fresh, ctx, false)
  newRoot.addSubcomponent(fresh)

  // Ausnahmen ab dem Teilungspunkt wandern in die neue Serie (sofern Zeiten unverändert)
  for (const o of overrides) {
    const prop = o.getFirstProperty('recurrence-id')
    const value = prop?.getFirstValue()
    if (!(value instanceof ICAL.Time)) continue
    const tzid = prop?.getParameter('tzid')
    const ms = timeInfoOf(value, typeof tzid === 'string' ? tzid : null, vtz)
    if (ms < splitUtc) continue
    root.removeSubcomponent(o)
    if (!shifts) {
      const moved = clone(o)
      moved.updatePropertyWithValue('uid', newUid)
      newRoot.addSubcomponent(moved)
    }
  }

  // Ursprüngliche Serie endet vor dem Teilungspunkt
  removeExdatesFrom(master, vtz, splitUtc, true)
  setUntil(master, masterTimes.start, splitUtc)
  stampNow(master, ctx, true)

  return { ics: serializeCalendar(root), created: { ics: serializeCalendar(newRoot), uid: newUid } }
}

function datePartWall(day: string): Wall {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return { y, m, d, h: 0, mi: 0, s: 0 }
}

// --- Löschen -----------------------------------------------------------------------------

export type DeleteResult = { kind: 'delete' } | { kind: 'update'; ics: string }

export function deleteFromIcs(
  ics: string,
  args: { scope: CalendarEditScope; recurrenceId: string | null },
  ctx: EditContext = defaultEditContext()
): DeleteResult {
  const root = parseCalendar(ics)
  const vtz = vtimezonesOf(root)
  const { master, overrides } = splitComponents(root, 'vevent')
  const recurring = !!master && (master.hasProperty('rrule') || master.hasProperty('rdate'))
  const rid = args.recurrenceId
  if (!master || !recurring || rid === null || args.scope === 'all') return { kind: 'delete' }
  const masterTimes = eventTimes(master, vtz)
  if (!masterTimes) return { kind: 'delete' }
  if (args.scope === 'following' && rid === recurrenceIdOf(masterTimes.start)) {
    return { kind: 'delete' }
  }
  assertOccurrence(root, rid)
  const splitUtc = recurrenceIdToUtcMs(rid)

  if (args.scope === 'this') {
    const existing = findOverride(root, rid)
    if (existing) root.removeSubcomponent(existing)
    const ex = ridProp('exdate', rid, masterTimes.start)
    master.addProperty(ex)
    stampNow(master, ctx, true)
    return { kind: 'update', ics: serializeCalendar(root) }
  }

  // following
  for (const o of overrides) {
    const prop = o.getFirstProperty('recurrence-id')
    const value = prop?.getFirstValue()
    if (!(value instanceof ICAL.Time)) continue
    const tzid = prop?.getParameter('tzid')
    if (timeInfoOf(value, typeof tzid === 'string' ? tzid : null, vtz) >= splitUtc) {
      root.removeSubcomponent(o)
    }
  }
  removeExdatesFrom(master, vtz, splitUtc, true)
  setUntil(master, masterTimes.start, splitUtc)
  stampNow(master, ctx, true)
  return { kind: 'update', ics: serializeCalendar(root) }
}
