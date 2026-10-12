import { parseDayKey, pad2, utcToWall, wallToUtc, systemTz } from './dates'

// RRULE-Baukasten für die darstellbare Teilmenge (Editor): FREQ (täglich/wöchentlich/
// monatlich/jährlich), INTERVAL, BYDAY (nur wöchentlich, reine Wochentage), Ende per
// UNTIL oder COUNT. Alles andere gilt als „benutzerdefiniert" und wird nur als
// Text angezeigt — der Editor schreibt es nie um.

export const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const
export type Weekday = (typeof WEEKDAYS)[number]
export type RecurrenceFreq = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export type RecurrenceEnd =
  { kind: 'never' } | { kind: 'until'; date: string } | { kind: 'count'; count: number }

export interface RecurrenceSpec {
  freq: RecurrenceFreq
  interval: number
  byday: Weekday[]
  end: RecurrenceEnd
}

export const NO_RECURRENCE: RecurrenceSpec = {
  freq: 'NONE',
  interval: 1,
  byday: [],
  end: { kind: 'never' }
}

export interface RruleContext {
  allDay: boolean
  /** Zone des Termins (null = floating → Systemzone) */
  tzid: string | null
}

export type ParsedRrule = { kind: 'spec'; spec: RecurrenceSpec } | { kind: 'custom'; text: string }

export const MAX_INTERVAL = 999

/** Wochentag-Kürzel eines Datums ('YYYY-MM-DD'). */
export function weekdayOf(dateKey: string): Weekday {
  return WEEKDAYS[(parseDayKey(dateKey).getDay() + 6) % 7]
}

function untilValue(date: string, ctx: RruleContext): string {
  const compact = date.replaceAll('-', '')
  if (ctx.allDay) return compact
  // Bei Zeitterminen: UTC-Zeitpunkt „Ende des Tages" in der Zone des Termins
  const utc = wallToUtc(`${date}T23:59:59`, ctx.tzid ?? systemTz())
  const d = new Date(utc)
  return (
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}` +
    `T${pad2(d.getUTCHours())}${pad2(d.getUTCMinutes())}${pad2(d.getUTCSeconds())}Z`
  )
}

/** RRULE-Wert (ohne 'RRULE:'-Präfix) aus der Auswahl; null = keine Wiederholung. */
export function buildRrule(spec: RecurrenceSpec, ctx: RruleContext): string | null {
  if (spec.freq === 'NONE') return null
  const parts = [`FREQ=${spec.freq}`]
  const interval = Math.min(MAX_INTERVAL, Math.max(1, Math.trunc(spec.interval) || 1))
  if (interval > 1) parts.push(`INTERVAL=${interval}`)
  if (spec.freq === 'WEEKLY' && spec.byday.length > 0) {
    const sorted = WEEKDAYS.filter((d) => spec.byday.includes(d))
    parts.push(`BYDAY=${sorted.join(',')}`)
  }
  if (spec.end.kind === 'until') parts.push(`UNTIL=${untilValue(spec.end.date, ctx)}`)
  else if (spec.end.kind === 'count') {
    parts.push(`COUNT=${Math.min(MAX_INTERVAL, Math.max(1, Math.trunc(spec.end.count) || 1))}`)
  }
  return parts.join(';')
}

function untilToDate(raw: string, ctx: RruleContext): string | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(raw)
  if (!m) return null
  const date = `${m[1]}-${m[2]}-${m[3]}`
  if (m[7] !== 'Z') return date
  // UTC-Zeitpunkt → Kalendertag in der Zone des Termins
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])
  return utcToWall(ms, ctx.allDay ? 'UTC' : (ctx.tzid ?? systemTz())).slice(0, 10)
}

/**
 * RRULE → Auswahl. Alles außerhalb der Teilmenge (BYSETPOS, BYMONTHDAY, BYMONTH,
 * BYDAY mit Ordnungszahl, WKST ≠ MO, UNTIL+COUNT, …) → 'custom' mit dem Originaltext.
 */
export function parseRrule(rule: string | null, ctx: RruleContext): ParsedRrule {
  if (!rule || !rule.trim()) return { kind: 'spec', spec: NO_RECURRENCE }
  const text = rule.trim().replace(/^RRULE:/i, '')
  const custom: ParsedRrule = { kind: 'custom', text }
  const map = new Map<string, string>()
  for (const part of text.split(';')) {
    const eq = part.indexOf('=')
    if (eq <= 0) return custom
    const key = part.slice(0, eq).toUpperCase()
    if (map.has(key)) return custom
    map.set(key, part.slice(eq + 1))
  }
  for (const key of map.keys()) {
    if (!['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST'].includes(key)) return custom
  }
  const freq = map.get('FREQ')?.toUpperCase()
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') {
    return custom
  }
  if (map.has('WKST') && map.get('WKST')?.toUpperCase() !== 'MO') return custom
  let interval = 1
  if (map.has('INTERVAL')) {
    const raw = map.get('INTERVAL') ?? ''
    if (!/^\d+$/.test(raw)) return custom
    interval = Number(raw)
    if (interval < 1 || interval > MAX_INTERVAL) return custom
  }
  const byday: Weekday[] = []
  if (map.has('BYDAY')) {
    if (freq !== 'WEEKLY') return custom
    for (const d of (map.get('BYDAY') ?? '').toUpperCase().split(',')) {
      if (!(WEEKDAYS as readonly string[]).includes(d)) return custom
      if (!byday.includes(d as Weekday)) byday.push(d as Weekday)
    }
  }
  if (map.has('UNTIL') && map.has('COUNT')) return custom
  let end: RecurrenceEnd = { kind: 'never' }
  if (map.has('UNTIL')) {
    const date = untilToDate(map.get('UNTIL') ?? '', ctx)
    if (!date) return custom
    end = { kind: 'until', date }
  } else if (map.has('COUNT')) {
    const raw = map.get('COUNT') ?? ''
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return custom
    end = { kind: 'count', count: Number(raw) }
  }
  return {
    kind: 'spec',
    spec: { freq, interval, byday: WEEKDAYS.filter((d) => byday.includes(d)), end }
  }
}
