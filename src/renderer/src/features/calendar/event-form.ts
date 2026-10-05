import type { CalendarEventFields } from '@shared/calendar-types'
import {
  addDays,
  dayKey,
  localWall,
  parseDayKey,
  systemTz,
  wallAsUtcMs,
  utcMsAsWall
} from './dates'
import { alarmChoiceOf, alarmsFromChoice, type AlarmChoice } from './alarms'
import {
  buildRrule,
  parseRrule,
  weekdayOf,
  NO_RECURRENCE,
  type RecurrenceFreq,
  type RecurrenceSpec
} from './rrule'

// Formularzustand des Termin-Editors und seine Umwandlung von/zu den Backend-Feldern.
// Ganztägige Termine zeigen das Enddatum INKLUSIV (Nutzersicht); gespeichert wird
// exklusiv (wie das Backend es erwartet).

export interface EventForm {
  summary: string
  location: string
  description: string
  allDay: boolean
  /** 'YYYY-MM-DD' */
  startDate: string
  /** 'HH:mm' (bei allDay unbenutzt) */
  startTime: string
  /** Bei allDay inklusiv */
  endDate: string
  endTime: string
  /** IANA-Zone; null = floating */
  tzid: string | null
  calendarId: number | null
  rec: RecurrenceSpec
  /** Nicht darstellbare Regel: Originaltext, wird unverändert beibehalten */
  recCustom: string | null
  alarm: AlarmChoice
  transparency: 'OPAQUE' | 'TRANSPARENT'
}

export type FormError = 'endBeforeStart' | 'invalidTime' | 'invalidUntil'

/** Dauer neuer Termine (Minuten). */
export const DEFAULT_DURATION_MIN = 60

function wallParts(wall: string): { date: string; time: string } {
  return { date: wall.slice(0, 10), time: wall.length >= 16 ? wall.slice(11, 16) : '00:00' }
}

export function formFromFields(fields: CalendarEventFields, calendarId: number): EventForm {
  const t = fields.time
  const s = wallParts(t.start)
  const e = wallParts(t.end)
  let endDate = e.date
  if (t.allDay) {
    // exklusiv → inklusiv, nie vor dem Start
    const incl = dayKey(addDays(parseDayKey(e.date), -1))
    endDate = incl < s.date ? s.date : incl
  }
  const tzid = t.allDay ? systemTz() : t.tzid
  const parsed = parseRrule(fields.rrule, { allDay: t.allDay, tzid })
  return {
    summary: fields.summary,
    location: fields.location ?? '',
    description: fields.description ?? '',
    allDay: t.allDay,
    startDate: s.date,
    startTime: s.time,
    endDate,
    endTime: e.time,
    tzid,
    calendarId,
    rec: parsed.kind === 'spec' ? parsed.spec : NO_RECURRENCE,
    recCustom: parsed.kind === 'custom' ? parsed.text : null,
    alarm: alarmChoiceOf(fields.alarms),
    transparency: fields.transparency ?? 'OPAQUE'
  }
}

/** Neuer Termin im Zeitfenster [startMs, endMs) (lokale Zeit). */
export function formFromSlot(
  startMs: number,
  endMs: number,
  allDay: boolean,
  calendarId: number | null
): EventForm {
  const s = wallParts(localWall(startMs))
  const e = wallParts(localWall(endMs))
  return {
    summary: '',
    location: '',
    description: '',
    allDay,
    startDate: s.date,
    startTime: s.time,
    // allDay: Fenster ist [Tag, Tag+1) → inklusives Ende = letzter Tag
    endDate: allDay ? dayKey(addDays(parseDayKey(e.date), e.time === '00:00' ? -1 : 0)) : e.date,
    endTime: e.time,
    tzid: systemTz(),
    calendarId,
    rec: NO_RECURRENCE,
    recCustom: null,
    alarm: 'none',
    transparency: 'OPAQUE'
  }
}

/** Standardfenster für einen Klick/`n`: ab `startMs` eine Stunde. */
export function defaultSlot(startMs: number): { startMs: number; endMs: number } {
  const d = new Date(startMs)
  return {
    startMs,
    endMs: new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      d.getHours(),
      d.getMinutes() + DEFAULT_DURATION_MIN
    ).getTime()
  }
}

function startWall(form: EventForm): string {
  return `${form.startDate}T${form.startTime}:00`
}
function endWall(form: EventForm): string {
  return `${form.endDate}T${form.endTime}:00`
}

export function validateForm(form: EventForm): FormError | null {
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(form.endDate)) {
    return 'invalidTime'
  }
  if (form.allDay) {
    if (form.endDate < form.startDate) return 'endBeforeStart'
  } else {
    if (!timeOk.test(form.startTime) || !timeOk.test(form.endTime)) return 'invalidTime'
    if (endWall(form) <= startWall(form)) return 'endBeforeStart'
  }
  if (form.rec.end.kind === 'until') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.rec.end.date) || form.rec.end.date < form.startDate) {
      return 'invalidUntil'
    }
  }
  return null
}

function sameTimeAtMinute(a: CalendarEventFields['time'], b: CalendarEventFields['time']): boolean {
  if (a.allDay !== b.allDay || (a.tzid ?? null) !== (b.tzid ?? null)) return false
  const cut = a.allDay ? 10 : 16
  return (
    a.start.slice(0, cut) === b.start.slice(0, cut) && a.end.slice(0, cut) === b.end.slice(0, cut)
  )
}

/**
 * Backend-Felder aus dem Formular. `base` (bestehender Termin) liefert alles, was der
 * Editor nicht ändert: Status, Teilnehmer, Organisator, nicht darstellbare Alarme/Regeln.
 */
export function fieldsFromForm(
  form: EventForm,
  base: CalendarEventFields | null
): CalendarEventFields {
  let time: CalendarEventFields['time'] = form.allDay
    ? {
        allDay: true,
        start: form.startDate,
        end: dayKey(addDays(parseDayKey(form.endDate), 1)),
        tzid: null
      }
    : { allDay: false, start: startWall(form), end: endWall(form), tzid: form.tzid }
  // Unverändert gebliebenes (Sekunden fallen im Formular weg) exakt wie geladen zurückgeben,
  // damit der Diff nichts Ungewolltes meldet — ein Zeit-Patch auf eine Serie wäre folgenreich.
  if (base && sameTimeAtMinute(base.time, time)) time = base.time
  const ctx = { allDay: form.allDay, tzid: form.tzid }
  let rrule: string | null
  if (form.recCustom !== null) rrule = base?.rrule ?? form.recCustom
  else if (base) {
    const parsed = parseRrule(base.rrule, ctx)
    rrule =
      parsed.kind === 'spec' && JSON.stringify(parsed.spec) === JSON.stringify(form.rec)
        ? base.rrule
        : buildRrule(form.rec, ctx)
  } else rrule = buildRrule(form.rec, ctx)
  const baseTransparency = base?.transparency ?? null
  return {
    summary: form.summary.trim(),
    location: form.location.trim() || null,
    description: form.description.trim() ? form.description : null,
    time,
    rrule,
    status: base?.status ?? null,
    // Kein ausdrücklicher Wert + „beschäftigt" = unverändert (RFC-Standard OPAQUE)
    transparency:
      baseTransparency === null && form.transparency === 'OPAQUE' ? null : form.transparency,
    alarms:
      base && alarmChoiceOf(base.alarms) === form.alarm
        ? base.alarms
        : alarmsFromChoice(form.alarm, base?.alarms ?? []),
    attendees: base?.attendees ?? [],
    organizer: base?.organizer ?? null
  }
}

/** Startdatum/-zeit ändern; die Dauer bleibt erhalten (Ende wandert mit). */
export function withStart(form: EventForm, date: string, time: string): EventForm {
  if (form.allDay) {
    const span = parseDayKey(form.endDate).getTime() - parseDayKey(form.startDate).getTime()
    const days = Math.max(0, Math.round(span / 86_400_000))
    return { ...form, startDate: date, endDate: dayKey(addDays(parseDayKey(date), days)) }
  }
  const dur = wallAsUtcMs(endWall(form)) - wallAsUtcMs(startWall(form))
  const next = { ...form, startDate: date, startTime: time }
  if (!Number.isFinite(dur) || dur <= 0) return next
  const end = utcMsAsWall(wallAsUtcMs(`${date}T${time}:00`) + dur)
  return { ...next, endDate: end.slice(0, 10), endTime: end.slice(11, 16) }
}

/** Ganztägig umschalten mit sinnvollen Standardzeiten. */
export function withAllDay(form: EventForm, allDay: boolean): EventForm {
  if (allDay === form.allDay) return form
  if (allDay) {
    return {
      ...form,
      allDay: true,
      endDate: form.endDate < form.startDate ? form.startDate : form.endDate
    }
  }
  return {
    ...form,
    allDay: false,
    startTime: '09:00',
    endTime: '10:00',
    endDate: form.startDate,
    tzid: form.tzid ?? systemTz()
  }
}

/** Wiederholung wechseln; wöchentlich ohne Tage bekommt den Wochentag des Starts. */
export function withFreq(form: EventForm, freq: RecurrenceFreq): EventForm {
  const rec: RecurrenceSpec = { ...form.rec, freq }
  if (freq === 'WEEKLY' && rec.byday.length === 0) rec.byday = [weekdayOf(form.startDate)]
  if (freq !== 'WEEKLY') rec.byday = []
  return { ...form, rec, recCustom: null }
}
