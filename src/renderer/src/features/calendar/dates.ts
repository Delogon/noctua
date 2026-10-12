// Pure date helpers of the calendar view. Everything uses local Date arithmetic
// (`new Date(y, m, d + n)`), never 24-h milliseconds — so days stay correct
// across DST changes (23/25 h). The week starts on Monday.

export type CalView = 'day' | 'week' | 'month'

export const DAY_MIN = 1440

export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Local calendar day as 'YYYY-MM-DD'. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

/** 'YYYY-MM-DD' → local midnight. */
export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Local midnight of `d` + n calendar days (DST-safe). */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** Calendar day difference b − a (both normalized to start of day, DST-safe). */
export function diffDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / 86_400_000)
}

/** Start of week (default Monday) as local midnight. */
export function startOfWeek(d: Date, weekStart = 1): Date {
  const delta = (d.getDay() - weekStart + 7) % 7
  return addDays(d, -delta)
}

/** Shift the month; the day is clamped to the month length (Jan 31 → Feb 28). */
export function addMonths(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last))
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

/** Days [start, start + n) as local midnights. */
export function daysFrom(start: Date, n: number): Date[] {
  return Array.from({ length: n }, (_, i) => addDays(start, i))
}

/** Month grid: full weeks (Mon–Sun) covering the month (4–6 rows). */
export function monthGrid(anchor: Date): Date[][] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0)
  const start = startOfWeek(first)
  const weeks = Math.ceil((diffDays(start, last) + 1) / 7)
  return Array.from({ length: weeks }, (_, w) => daysFrom(addDays(start, w * 7), 7))
}

/** Visible range [start, end) of the view around the anchor day. */
export function visibleRange(view: CalView, anchor: Date): { start: Date; end: Date } {
  if (view === 'day') {
    const start = startOfDay(anchor)
    return { start, end: addDays(start, 1) }
  }
  if (view === 'week') {
    const start = startOfWeek(anchor)
    return { start, end: addDays(start, 7) }
  }
  const grid = monthGrid(anchor)
  return { start: grid[0][0], end: addDays(grid[grid.length - 1][6], 1) }
}

/** Days of the week/day view. */
export function viewDays(view: CalView, anchor: Date): Date[] {
  if (view === 'day') return [startOfDay(anchor)]
  return daysFrom(startOfWeek(anchor), 7)
}

/** One period forward/back (dir = ±1). */
export function shiftAnchor(view: CalView, anchor: Date, dir: number): Date {
  if (view === 'day') return addDays(anchor, dir)
  if (view === 'week') return addDays(anchor, 7 * dir)
  return addMonths(anchor, dir)
}

/** ISO 8601 calendar week. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dow)
  const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1)
  return Math.ceil(((t.getTime() - yearStart) / 86_400_000 + 1) / 7)
}

/** Minutes since local midnight (wall time) of a timestamp. */
export function wallMinutes(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Next full hour after `now`. */
export function nextFullHour(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0)
}

export function systemTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

// --- Wall-time strings ('YYYY-MM-DDTHH:mm:ss') ----------------------------------------------

/** Local timestamp → wall-time string of the system zone. */
export function localWall(ms: number): string {
  const d = new Date(ms)
  return `${dayKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00`
}

/** Wall-time string (read as UTC) → milliseconds; for pure difference calculations. */
export function wallAsUtcMs(wall: string): number {
  return Date.parse(wall.length === 10 ? `${wall}T00:00:00Z` : `${wall}Z`)
}

/** Inverse of wallAsUtcMs; `dateOnly` truncates to 'YYYY-MM-DD'. */
export function utcMsAsWall(ms: number, dateOnly = false): string {
  const iso = new Date(ms).toISOString()
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 19)
}

const dtfCache = new Map<string, Intl.DateTimeFormat>()
function zoneFormat(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
    dtfCache.set(tz, f)
  }
  return f
}

/** UTC timestamp → wall-time string in `tz`. */
export function utcToWall(ms: number, tz: string): string {
  const parts: Record<string, string> = {}
  for (const p of zoneFormat(tz).formatToParts(new Date(ms))) parts[p.type] = p.value
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/** Wall time in `tz` → UTC timestamp (two-pass approximation, also around DST changes). */
export function wallToUtc(wall: string, tz: string): number {
  const asUtc = wallAsUtcMs(wall)
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const offset = wallAsUtcMs(utcToWall(guess, tz)) - guess
    guess = asUtc - offset
  }
  return guess
}

/** Read 'HH:mm' leniently ('9', '930', '9.30', '09:30'); null = invalid. */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  let h: number
  let m: number
  const sep = /^(\d{1,2})[:.](\d{1,2})$/.exec(s)
  if (sep) {
    h = Number(sep[1])
    m = Number(sep[2])
  } else if (/^\d{3,4}$/.test(s)) {
    h = Number(s.slice(0, -2))
    m = Number(s.slice(-2))
  } else if (/^\d{1,2}$/.test(s)) {
    h = Number(s)
    m = 0
  } else return null
  if (h > 23 || m > 59) return null
  return `${pad2(h)}:${pad2(m)}`
}
