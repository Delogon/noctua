import ICAL from 'ical.js'

/**
 * Zeitzonen-Schicht. IANA-Zonen laufen über Intl (Node bringt volle ICU-Daten
 * mit), unabhängig davon, ob die ICS ein VTIMEZONE enthält. Unbekannte TZIDs
 * (Windows-Namen, proprietäre IDs) fallen auf ein eingebettetes VTIMEZONE
 * (ical.js), eine kleine Windows→IANA-Tabelle oder die Systemzone zurück.
 */

export interface Wall {
  y: number
  m: number
  d: number
  h: number
  mi: number
  s: number
}

export interface Zone {
  /** Zonen-ID, wie sie in TZID geschrieben wird (null = UTC-/Floating-Ersatz) */
  id: string
  wallToUtc(w: Wall): number
  utcToWall(ms: number): Wall
}

const validCache = new Map<string, boolean>()
const formatters = new Map<string, Intl.DateTimeFormat>()

export function isValidIana(tzid: string): boolean {
  const hit = validCache.get(tzid)
  if (hit !== undefined) return hit
  let ok = false
  // Intl akzeptiert auch Offsets ('+01:00') und alte Aliase; wir wollen Region/Stadt-IDs und UTC
  if (/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tzid)) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tzid })
      ok = true
    } catch {
      ok = false
    }
  }
  validCache.set(tzid, ok)
  return ok
}

function formatter(tzid: string): Intl.DateTimeFormat {
  let f = formatters.get(tzid)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tzid,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    formatters.set(tzid, f)
  }
  return f
}

export function utcToWallIana(ms: number, tzid: string): Wall {
  const parts = formatter(tzid).formatToParts(new Date(ms))
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour') % 24,
    mi: get('minute'),
    s: get('second')
  }
}

export function wallAsUtcMs(w: Wall): number {
  // Date.UTC kennt Jahre < 100 nur als 1900+; Kalenderdaten bleiben im sicheren Bereich
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s)
}

/** Offset (ms, positiv = östlich von UTC) der Zone zum Zeitpunkt utcMs. */
export function offsetAtIana(utcMs: number, tzid: string): number {
  const floor = Math.floor(utcMs / 1000) * 1000
  return wallAsUtcMs(utcToWallIana(floor, tzid)) - floor
}

/**
 * Wandzeit → UTC. Mehrdeutige Zeiten (Herbst, doppelte Stunde) nehmen den
 * ersten Zeitpunkt; nicht existierende (Frühjahrslücke) werden mit dem Offset
 * vor der Umstellung gerechnet (RFC 5545 §3.3.5).
 */
export function wallToUtcIana(w: Wall, tzid: string): number {
  const guess = wallAsUtcMs(w)
  const DAY = 24 * 3600_000
  const before = offsetAtIana(guess - DAY, tzid)
  const after = offsetAtIana(guess + DAY, tzid)
  const candidates = new Set<number>()
  for (const off of new Set([before, after])) {
    const utc = guess - off
    if (offsetAtIana(utc, tzid) === off) candidates.add(utc)
  }
  if (candidates.size === 0) return guess - before
  return Math.min(...candidates)
}

export function ianaZone(tzid: string): Zone {
  return {
    id: tzid,
    wallToUtc: (w) => wallToUtcIana(w, tzid),
    utcToWall: (ms) => utcToWallIana(ms, tzid)
  }
}

export const UTC_ZONE: Zone = {
  id: 'UTC',
  wallToUtc: (w) => wallAsUtcMs(w),
  utcToWall: (ms) => {
    const d = new Date(ms)
    return {
      y: d.getUTCFullYear(),
      m: d.getUTCMonth() + 1,
      d: d.getUTCDate(),
      h: d.getUTCHours(),
      mi: d.getUTCMinutes(),
      s: d.getUTCSeconds()
    }
  }
}

export function systemTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && isValidIana(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

/** Häufige Windows-/Exchange-Zonennamen → IANA. */
const WINDOWS_ZONES: Record<string, string> = {
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Central European Standard Time': 'Europe/Warsaw',
  'Romance Standard Time': 'Europe/Paris',
  'GMT Standard Time': 'Europe/London',
  'GTB Standard Time': 'Europe/Bucharest',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'FLE Standard Time': 'Europe/Kiev',
  'Russian Standard Time': 'Europe/Moscow',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Alaskan Standard Time': 'America/Anchorage',
  'Atlantic Standard Time': 'America/Halifax',
  'India Standard Time': 'Asia/Kolkata',
  'China Standard Time': 'Asia/Shanghai',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'Korea Standard Time': 'Asia/Seoul',
  'Singapore Standard Time': 'Asia/Singapore',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'Arab Standard Time': 'Asia/Riyadh',
  'Israel Standard Time': 'Asia/Jerusalem',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'E. South America Standard Time': 'America/Sao_Paulo',
  UTC: 'UTC'
}

/** Gespeicherte VTIMEZONE-Komponenten einer ICS, nach TZID. */
export type VTimezones = Map<string, ICAL.Component>

function customZone(tzid: string, vtimezone: ICAL.Component): Zone {
  const tz = new ICAL.Timezone(vtimezone)
  return {
    id: tzid,
    wallToUtc: (w) => {
      const t = new ICAL.Time(
        { year: w.y, month: w.m, day: w.d, hour: w.h, minute: w.mi, second: w.s },
        tz
      )
      return t.toUnixTime() * 1000
    },
    utcToWall: (ms) => {
      const t = ICAL.Time.fromJSDate(new Date(Math.floor(ms / 1000) * 1000), true).convertToZone(tz)
      return { y: t.year, m: t.month, d: t.day, h: t.hour, mi: t.minute, s: t.second }
    }
  }
}

/**
 * Löst eine TZID zu einer Zone auf. `null`/leer = floating → Systemzone.
 * `Z`-Zeiten (UTC) werden vom Aufrufer direkt über UTC_ZONE behandelt.
 */
export function resolveZone(tzid: string | null, vtimezones?: VTimezones): Zone {
  if (!tzid) return ianaZone(systemTimeZone())
  if (tzid.toUpperCase() === 'UTC' || tzid === 'Z') return UTC_ZONE
  if (isValidIana(tzid)) return ianaZone(tzid)
  const embedded = vtimezones?.get(tzid)
  if (embedded) {
    try {
      return customZone(tzid, embedded)
    } catch {
      // defektes VTIMEZONE → weiter mit Fallbacks
    }
  }
  const windows = WINDOWS_ZONES[tzid]
  if (windows) return ianaZone(windows)
  // Pfad-Präfixe wie /freeassociation.sourceforge.net/Europe/Berlin
  const segs = tzid.split('/')
  for (let n = 2; n >= 1; n--) {
    const tail = segs.slice(-n).join('/')
    if (tail && isValidIana(tail)) return ianaZone(tail)
  }
  return ianaZone(systemTimeZone())
}

// --- VTIMEZONE-Erzeugung (für neue Ereignisse mit TZID) ----------------------------

interface Transition {
  utc: number
  fromOffset: number
  toOffset: number
}

function findTransitions(tzid: string, fromYear: number, toYear: number): Transition[] {
  const out: Transition[] = []
  const step = 24 * 3600_000
  let t = Date.UTC(fromYear, 0, 1)
  const end = Date.UTC(toYear + 1, 0, 1)
  let prev = offsetAtIana(t, tzid)
  while (t < end) {
    const next = t + step
    const off = offsetAtIana(next, tzid)
    if (off !== prev) {
      // Umstellung innerhalb (t, next]: auf die Sekunde eingrenzen
      let lo = t
      let hi = next
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2)
        if (offsetAtIana(mid, tzid) === prev) lo = mid
        else hi = mid
      }
      out.push({ utc: hi, fromOffset: prev, toOffset: off })
      prev = off
    }
    t = next
  }
  return out
}

function pad(n: number, len = 2): string {
  return String(n).padStart(len, '0')
}

/**
 * Baut ein VTIMEZONE für eine IANA-Zone: Regeln mit jährlicher Wiederholung
 * (z. B. letzter Sonntag im März), sofern über mehrere Jahre gleichförmig,
 * sonst RDATE-Listen. Reicht für Interoperabilität mit Clients, die kein IANA
 * kennen; die eigentliche Berechnung macht Noctua selbst über Intl.
 */
export function buildVTimezone(tzid: string, aroundYear: number): ICAL.Component {
  const vtz = new ICAL.Component('vtimezone')
  vtz.addPropertyWithValue('tzid', tzid)
  const fromYear = aroundYear - 1
  const toYear = aroundYear + 8
  const transitions = findTransitions(tzid, fromYear, toYear)

  const addObservance = (
    kind: 'standard' | 'daylight',
    from: number,
    to: number,
    localStart: Wall,
    rule: string | null,
    rdates: Wall[]
  ): void => {
    const obs = new ICAL.Component(kind)
    obs.addPropertyWithValue('tzoffsetfrom', ICAL.UtcOffset.fromSeconds(from / 1000))
    obs.addPropertyWithValue('tzoffsetto', ICAL.UtcOffset.fromSeconds(to / 1000))
    obs.addPropertyWithValue('dtstart', ICAL.Time.fromDateTimeString(fmtIso(localStart)))
    if (rule) obs.addPropertyWithValue('rrule', ICAL.Recur.fromString(rule))
    for (const r of rdates) {
      obs.addPropertyWithValue('rdate', ICAL.Time.fromDateTimeString(fmtIso(r)))
    }
    vtz.addSubcomponent(obs)
  }

  if (transitions.length === 0) {
    const off = offsetAtIana(Date.UTC(aroundYear, 0, 1), tzid)
    addObservance('standard', off, off, { y: 1970, m: 1, d: 1, h: 0, mi: 0, s: 0 }, null, [])
    return vtz
  }

  // Gruppieren nach (fromOffset→toOffset): gleiche Regel pro Jahr?
  const groups = new Map<string, Transition[]>()
  for (const tr of transitions) {
    const key = `${tr.fromOffset}>${tr.toOffset}`
    groups.set(key, [...(groups.get(key) ?? []), tr])
  }
  for (const group of groups.values()) {
    const first = group[0]
    const isDst = first.toOffset > first.fromOffset
    const localOf = (tr: Transition): Wall => utcToWallOffset(tr.utc, tr.fromOffset)
    const locals = group.map(localOf)
    const rule = yearlyRule(locals)
    addObservance(
      isDst ? 'daylight' : 'standard',
      first.fromOffset,
      first.toOffset,
      locals[0],
      rule && group.length >= 3 ? rule : null,
      rule && group.length >= 3 ? [] : locals.slice(1)
    )
  }
  return vtz
}

function fmtIso(w: Wall): string {
  return `${pad(w.y, 4)}-${pad(w.m)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`
}

function utcToWallOffset(utc: number, offset: number): Wall {
  return UTC_ZONE.utcToWall(utc + offset)
}

/** Gleiche Regel in allen Jahren? → 'FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU' (letzter/n-ter Wochentag). */
function yearlyRule(locals: Wall[]): string | null {
  const days = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
  const descr = locals.map((w) => {
    const dow = new Date(Date.UTC(w.y, w.m - 1, w.d)).getUTCDay()
    const dim = new Date(Date.UTC(w.y, w.m, 0)).getUTCDate()
    const nth = Math.ceil(w.d / 7)
    const last = w.d + 7 > dim
    return { m: w.m, dow, nth, last, time: `${w.h}:${w.mi}:${w.s}` }
  })
  const same = (pick: (d: (typeof descr)[number]) => unknown): boolean =>
    descr.every((d) => pick(d) === pick(descr[0]))
  if (!same((d) => d.m) || !same((d) => d.dow) || !same((d) => d.time)) return null
  const d0 = descr[0]
  if (descr.every((d) => d.last)) return `FREQ=YEARLY;BYMONTH=${d0.m};BYDAY=-1${days[d0.dow]}`
  if (same((d) => d.nth)) return `FREQ=YEARLY;BYMONTH=${d0.m};BYDAY=${d0.nth}${days[d0.dow]}`
  return null
}
