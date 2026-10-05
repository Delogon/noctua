import type { CalendarInstance } from '@shared/calendar-types'
import { addDays, dayKey, parseDayKey, wallMinutes, DAY_MIN } from './dates'

// Reine Layout-Algorithmen der Kalenderansicht: Tageszuordnung, Überlappungs-
// Spalten im Zeitraster, Bänder (ganztägig/mehrtägig) in Wochenzeilen.

/** Minimale Anzeigehöhe eines Termins im Raster (Minuten). */
export const MIN_BLOCK_MIN = 20

/** Termine ab dieser Länge laufen als Band (Ganztagszeile) statt im Zeitraster. */
const BANNER_MS = 24 * 3_600_000

/** Ganztägig oder ≥ 24 h → Band in der Ganztagszeile. */
export function isBanner(e: CalendarInstance): boolean {
  return e.allDay || e.endUtc - e.startUtc >= BANNER_MS
}

/** Belegte Kalendertage [startDay, endDay) (endDay exklusiv, 'YYYY-MM-DD'). */
export function dayRange(e: CalendarInstance): { startDay: string; endDay: string } {
  if (e.allDay && e.startDay) {
    const endDay =
      e.endDay && e.endDay > e.startDay ? e.endDay : dayKey(addDays(parseDayKey(e.startDay), 1))
    return { startDay: e.startDay, endDay }
  }
  // Ende exklusiv: ein Termin bis exakt 00:00 belegt den Folgetag nicht mehr
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

/** Gruppiert Termine nach Kalendertag (nur Tage aus `days`); innerhalb: Bänder zuerst, dann Start. */
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
  /** Minuten seit Tagesbeginn (Wandzeit) */
  top: number
  bottom: number
  /** Spalte innerhalb des Überlappungs-Clusters und Spaltenzahl des Clusters */
  col: number
  cols: number
}

/**
 * Zeitraster eines Tages: schneidet Termine auf den Tag zu, vergibt Überlappungs-
 * Spalten (Cluster = zusammenhängende Überlappungskette; jede Spalte erhält die
 * Breite 1/cols des Clusters).
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

export interface Span<T> {
  item: T
  /** Erste Spalte (0-basiert) und Ende (exklusiv) innerhalb der Zeile */
  startCol: number
  endCol: number
  lane: number
  /** Beginnt/endet außerhalb des sichtbaren Bereichs */
  clippedStart: boolean
  clippedEnd: boolean
}

/**
 * Bänder über `days` ('YYYY-MM-DD'-Spalten): Spalten-Position und Spur. Eine Spur
 * wird nur von überlappungsfreien Spannen geteilt.
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
