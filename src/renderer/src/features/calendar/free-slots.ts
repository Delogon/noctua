// Shared free time of several attendees: pure logic for the availability strip and
// "next common free slot" in the event editor. Everything in local time (wall time of the
// system zone), days via the Date constructor — so DST changes are not a special case.

export interface Interval {
  startUtc: number
  endUtc: number
}

const STEP_MS = 15 * 60_000

/** Sorts and merges overlapping/adjacent intervals; empty ones are dropped. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const out: Interval[] = []
  for (const b of [...list]
    .filter((x) => x.endUtc > x.startUtc)
    .sort((a, b) => a.startUtc - b.startUtc || a.endUtc - b.endUtc)) {
    const last = out[out.length - 1]
    if (last && b.startUtc <= last.endUtc) last.endUtc = Math.max(last.endUtc, b.endUtc)
    else out.push({ startUtc: b.startUtc, endUtc: b.endUtc })
  }
  return out
}

/** Local hour `hour` on the day of `dayMs`. */
export function localDayAt(dayMs: number, hour: number): number {
  const d = new Date(dayMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour).getTime()
}

/** Start of the next quarter hour (>= ms). */
function ceilStep(ms: number): number {
  return Math.ceil(ms / STEP_MS) * STEP_MS
}

export interface CommonSlotOptions {
  /** Busy times per person; people without info do not belong here */
  busy: ReadonlyArray<readonly Interval[]>
  durationMs: number
  /** Earliest start (e.g. now) */
  fromMs: number
  /** Workdays Mon–Fri from the day of fromMs, default 10 */
  workingDays?: number
  startHour?: number
  endHour?: number
}

/** The next `count` workdays (Mon–Fri) as local starts of day. */
export function workingDayStarts(fromMs: number, count: number): number[] {
  const first = new Date(fromMs)
  const out: number[] = []
  // Upper bound against endless loops: 10 workdays = at most ~14 calendar days
  for (let i = 0; i < count * 3 + 7 && out.length < count; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    const wd = d.getDay()
    if (wd >= 1 && wd <= 5) out.push(d.getTime())
  }
  return out
}

/**
 * First time window of the given duration in which nobody is busy: snapped to quarter
 * hours, within working hours (default 08–18), never before `fromMs`. Null if
 * nothing is free within the workdays (or the duration does not fit into a workday).
 */
export function findCommonFreeSlot(opts: CommonSlotOptions): Interval | null {
  const { durationMs } = opts
  if (!(durationMs > 0)) return null
  const startHour = opts.startHour ?? 8
  const endHour = opts.endHour ?? 18
  const busy = mergeIntervals(opts.busy.flat())
  const from = ceilStep(opts.fromMs)
  for (const day of workingDayStarts(opts.fromMs, opts.workingDays ?? 10)) {
    const winStart = localDayAt(day, startHour)
    const winEnd = localDayAt(day, endHour)
    let cursor = Math.max(winStart, from)
    while (cursor + durationMs <= winEnd) {
      const end = cursor + durationMs
      const hit = busy.find((b) => b.endUtc > cursor && b.startUtc < end)
      if (!hit) return { startUtc: cursor, endUtc: end }
      cursor = ceilStep(hit.endUtc)
    }
  }
  return null
}

export interface StripSegment {
  /** Fractions 0..1 of the strip width */
  from: number
  to: number
  tentative: boolean
}

/** Busy times as fractions of a window [winStart, winEnd) for the strip display. */
export function stripSegments(
  busy: ReadonlyArray<Interval & { type?: string }>,
  winStart: number,
  winEnd: number
): StripSegment[] {
  const span = winEnd - winStart
  if (!(span > 0)) return []
  const out: StripSegment[] = []
  for (const b of busy) {
    const s = Math.max(b.startUtc, winStart)
    const e = Math.min(b.endUtc, winEnd)
    if (e <= s) continue
    out.push({
      from: (s - winStart) / span,
      to: (e - winStart) / span,
      tentative: b.type === 'BUSY-TENTATIVE'
    })
  }
  return out.sort((a, b) => a.from - b.from)
}

/** Does the time range overlap a busy time? */
export function conflictsWith(busy: readonly Interval[], slot: Interval): boolean {
  return busy.some((b) => b.endUtc > slot.startUtc && b.startUtc < slot.endUtc)
}

/** Local wall time 'YYYY-MM-DD' + 'HH:mm' as a timestamp; NaN for invalid input. */
export function wallToLocalMs(date: string, time: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2})$/.exec(time)
  if (!d || !t) return NaN
  return new Date(+d[1], +d[2] - 1, +d[3], +t[1], +t[2]).getTime()
}
