import type { CalendarInstance } from '@shared/calendar-types'
import { addDays, dayKey, parseDayKey, wallMinutes, DAY_MIN } from './dates'

// Pure layout algorithms of the calendar view: day assignment, overlap
// columns in the time grid, bands (all-day/multi-day) in week rows.

/** Minimum display height of an event in the grid (minutes). */
export const MIN_BLOCK_MIN = 20

/** Events of this length or longer run as a band (all-day row) instead of in the time grid. */
const BANNER_MS = 24 * 3_600_000

/** All-day or ≥ 24 h → band in the all-day row. */
export function isBanner(e: CalendarInstance): boolean {
  return e.allDay || e.endUtc - e.startUtc >= BANNER_MS
}

/** Occupied calendar days [startDay, endDay) (endDay exclusive, 'YYYY-MM-DD'). */
export function dayRange(e: CalendarInstance): { startDay: string; endDay: string } {
  if (e.allDay && e.startDay) {
    const endDay =
      e.endDay && e.endDay > e.startDay ? e.endDay : dayKey(addDays(parseDayKey(e.startDay), 1))
    return { startDay: e.startDay, endDay }
  }
  // End exclusive: an event until exactly 00:00 no longer occupies the following day
  const lastMs = Math.max(e.startUtc, e.endUtc - 1)
  return { startDay: dayKey(new Date(e.startUtc)), endDay: dayKey(addDays(new Date(lastMs), 1)) }
}

export function compareEvents(a: CalendarInstance, b: CalendarInstance): number {
  const ba = isBanner(a) ? 0 : 1
  const bb = isBanner(b) ? 0 : 1
  if (ba !== bb) return ba - bb
  if (a.startUtc !== b.startUtc) return a.startUtc - b.startUtc
  return b.endUtc - a.endUtc || a.key.localeCompare(b.key)
}

/** Groups events by calendar day (only days from `days`); within a day: bands first, then by start. */
export function eventsByDay(
  events: readonly CalendarInstance[],
  days: readonly Date[]
): Map<string, CalendarInstance[]> {
  const map = new Map<string, CalendarInstance[]>()
  for (const d of days) map.set(dayKey(d), [])
  for (const e of events) {
    const { startDay, endDay } = dayRange(e)
    for (const [k, list] of map) {
      if (k >= startDay && k < endDay) list.push(e)
    }
  }
  for (const list of map.values()) list.sort(compareEvents)
  return map
}

export interface Placed<T> {
  item: T
  /** Minutes since start of day (wall time) */
  top: number
  bottom: number
  /** Column within the overlap cluster and the cluster's column count */
  col: number
  cols: number
}

/**
 * Time grid of a day: clips events to the day, assigns overlap
 * columns (cluster = connected overlap chain; each column gets
 * width 1/cols of the cluster).
 */
export function layoutDay(
  events: readonly CalendarInstance[],
  day: Date
): Placed<CalendarInstance>[] {
  const dayStart = day.getTime()
  const dayEnd = addDays(day, 1).getTime()
  const items = events
    .filter((e) => e.endUtc > dayStart && e.startUtc < dayEnd)
    .map((item) => {
      const top = item.startUtc <= dayStart ? 0 : wallMinutes(item.startUtc)
      const bottom = item.endUtc >= dayEnd ? DAY_MIN : wallMinutes(item.endUtc)
      return { item, top, bottom: Math.max(bottom, Math.min(top + MIN_BLOCK_MIN, DAY_MIN)) }
    })
    .sort((a, b) => a.top - b.top || b.bottom - a.bottom || a.item.key.localeCompare(b.item.key))

  const placed: Placed<CalendarInstance>[] = []
  let cluster: Placed<CalendarInstance>[] = []
  let colEnds: number[] = []
  let clusterEnd = -1
  const flush = (): void => {
    for (const p of cluster) p.cols = colEnds.length
    placed.push(...cluster)
    cluster = []
    colEnds = []
    clusterEnd = -1
  }
  for (const it of items) {
    if (cluster.length > 0 && it.top >= clusterEnd) flush()
    let col = colEnds.findIndex((end) => end <= it.top)
    if (col === -1) {
      col = colEnds.length
      colEnds.push(it.bottom)
    } else colEnds[col] = it.bottom
    cluster.push({ ...it, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, it.bottom)
  }
  flush()
  return placed
}

/** Below this width (px) per overlap column an event title is no longer readable. */
const MIN_COL_PX = 64
/** Fraction of the column width that an overlapping event keeps in the cascade layout. */
const CASCADE_MAX_PCT = 85

/**
 * Horizontal position of a block in percent of the day column. Normal case: equally
 * wide columns. If each column would become narrower than MIN_COL_PX (week view,
 * 3 overlaps), the blocks are cascaded with an offset instead (each later one
 * lies above the previous one) — so every title stays readable.
 */
export function blockSpan(
  col: number,
  cols: number,
  colWidthPx: number
): { left: number; width: number; cascade: boolean } {
  if (cols <= 1 || colWidthPx <= 0 || colWidthPx / cols >= MIN_COL_PX) {
    return { left: (col / cols) * 100, width: 100 / cols, cascade: false }
  }
  const width = Math.max(100 / cols, Math.min(CASCADE_MAX_PCT, (MIN_COL_PX / colWidthPx) * 100))
  const step = (100 - width) / (cols - 1)
  return { left: col * step, width, cascade: true }
}

export interface Span<T> {
  item: T
  /** First column (0-based) and end (exclusive) within the row */
  startCol: number
  endCol: number
  lane: number
  /** Starts/ends outside the visible range */
  clippedStart: boolean
  clippedEnd: boolean
}

/**
 * Bands across `days` ('YYYY-MM-DD' columns): column position and lane. A lane
 * is only shared by non-overlapping spans.
 */
export function layoutSpans(
  events: readonly CalendarInstance[],
  days: readonly string[]
): { spans: Span<CalendarInstance>[]; lanes: number } {
  if (days.length === 0) return { spans: [], lanes: 0 }
  const first = days[0]
  const afterLast = dayKey(addDays(parseDayKey(days[days.length - 1]), 1))
  const rows: Span<CalendarInstance>[] = []
  for (const item of events) {
    const { startDay, endDay } = dayRange(item)
    const startCol = days.findIndex((d) => d >= startDay)
    if (startCol === -1) continue
    let endCol = days.findIndex((d) => d >= endDay)
    if (endCol === -1) endCol = days.length
    if (endCol <= startCol) continue
    rows.push({
      item,
      startCol,
      endCol,
      lane: 0,
      clippedStart: startDay < first,
      clippedEnd: endDay > afterLast
    })
  }
  rows.sort(
    (a, b) =>
      a.startCol - b.startCol ||
      b.endCol - b.startCol - (a.endCol - a.startCol) ||
      a.item.key.localeCompare(b.item.key)
  )
  const laneEnds: number[] = []
  for (const s of rows) {
    let lane = laneEnds.findIndex((end) => end <= s.startCol)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(s.endCol)
    } else laneEnds[lane] = s.endCol
    s.lane = lane
  }
  return { spans: rows, lanes: laneEnds.length }
}
