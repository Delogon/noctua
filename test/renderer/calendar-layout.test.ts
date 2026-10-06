import { describe, expect, it } from 'vitest'
import type { CalendarInstance } from '@shared/calendar-types'
import {
  dayRange,
  eventsByDay,
  isBanner,
  blockSpan,
  layoutDay,
  layoutSpans
} from '@renderer/features/calendar/layout'
import { agendaItems, agendaRange } from '@renderer/features/calendar/agenda'
import { dayKey, daysFrom } from '@renderer/features/calendar/dates'

// Zeitzone vor dem Sammeln der Tests setzen (Modul-Konstanten mit Date)
process.env.TZ = 'Europe/Berlin'

let seq = 0
function timed(start: Date, end: Date, over: Partial<CalendarInstance> = {}): CalendarInstance {
  seq += 1
  return {
    key: `t${seq}:`,
    objectId: seq,
    calendarId: 1,
    recurrenceId: null,
    startUtc: start.getTime(),
    endUtc: end.getTime(),
    allDay: false,
    startDay: null,
    endDay: null,
    summary: `E${seq}`,
    location: null,
    status: null,
    recurring: false,
    isOverride: false,
    pending: false,
    readOnly: false,
    ...over
  }
}
function allDay(startDay: string, endDay: string): CalendarInstance {
  const base = timed(new Date(0), new Date(0))
  return { ...base, allDay: true, startDay, endDay }
}

describe('Überlappungs-Layout', () => {
  const day = new Date(2026, 9, 5)
  const at = (h: number, m = 0): Date => new Date(2026, 9, 5, h, m)

  it('einzelner Termin: volle Breite', () => {
    const [p] = layoutDay([timed(at(9), at(10))], day)
    expect(p).toMatchObject({ top: 540, bottom: 600, col: 0, cols: 1 })
  })

  it('überlappende Termine teilen sich Spalten', () => {
    const a = timed(at(9), at(11))
    const b = timed(at(10), at(12))
    const c = timed(at(11), at(12))
    const placed = layoutDay([a, b, c], day)
    const byKey = new Map(placed.map((p) => [p.item.key, p]))
    expect(byKey.get(a.key)).toMatchObject({ col: 0, cols: 2 })
    expect(byKey.get(b.key)).toMatchObject({ col: 1, cols: 2 })
    // c beginnt, wenn a endet → wiederverwendet Spalte 0
    expect(byKey.get(c.key)).toMatchObject({ col: 0, cols: 2 })
  })

  it('getrennte Cluster behalten volle Breite', () => {
    const placed = layoutDay(
      [timed(at(8), at(9)), timed(at(8, 30), at(9, 30)), timed(at(13), at(14))],
      day
    )
    expect(placed.map((p) => p.cols).sort()).toEqual([1, 2, 2])
  })

  it('Termine gleichen Starts: längerer zuerst, drei Spalten', () => {
    const placed = layoutDay(
      [timed(at(9), at(10)), timed(at(9), at(11)), timed(at(9), at(9, 30))],
      day
    )
    expect(placed.every((p) => p.cols === 3)).toBe(true)
    expect(new Set(placed.map((p) => p.col)).size).toBe(3)
  })

  it('Mindesthöhe für sehr kurze Termine', () => {
    const [p] = layoutDay([timed(at(9), at(9))], day)
    expect(p.bottom - p.top).toBeGreaterThanOrEqual(20)
  })

  it('Termin über Mitternacht wird je Tag zugeschnitten', () => {
    const e = timed(new Date(2026, 9, 5, 22), new Date(2026, 9, 6, 2))
    const d1 = layoutDay([e], day)
    const d2 = layoutDay([e], new Date(2026, 9, 6))
    expect(d1[0]).toMatchObject({ top: 1320, bottom: 1440 })
    expect(d2[0]).toMatchObject({ top: 0, bottom: 120 })
    expect(layoutDay([e], new Date(2026, 9, 7))).toHaveLength(0)
  })

  it('Tag der Zeitumstellung (25-h-Tag): Wandzeit-Positionen bleiben stimmig', () => {
    const d = new Date(2026, 9, 25)
    const e = timed(new Date(2026, 9, 25, 9), new Date(2026, 9, 25, 10))
    expect(layoutDay([e], d)[0]).toMatchObject({ top: 540, bottom: 600 })
    // Termin bis Tagesende
    const late = timed(new Date(2026, 9, 25, 23), new Date(2026, 9, 26, 0))
    expect(layoutDay([late], d)[0]).toMatchObject({ top: 1380, bottom: 1440 })
  })
})

describe('Tageszuordnung', () => {
  it('ganztägig: nach startDay/endDay (exklusiv), nicht nach UTC', () => {
    const e = allDay('2026-10-05', '2026-10-08')
    expect(dayRange(e)).toEqual({ startDay: '2026-10-05', endDay: '2026-10-08' })
    const days = daysFrom(new Date(2026, 9, 4), 6)
    const map = eventsByDay([e], days)
    expect([...map].filter(([, l]) => l.length).map(([k]) => k)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07'
    ])
  })

  it('eintägig ohne endDay wird auf einen Tag begrenzt', () => {
    expect(dayRange(allDay('2026-10-05', '2026-10-05'))).toEqual({
      startDay: '2026-10-05',
      endDay: '2026-10-06'
    })
  })

  it('Termin bis exakt Mitternacht belegt den Folgetag nicht', () => {
    const e = timed(new Date(2026, 9, 5, 20), new Date(2026, 9, 6, 0))
    expect(dayRange(e)).toEqual({ startDay: '2026-10-05', endDay: '2026-10-06' })
  })

  it('Banner = ganztägig oder ≥ 24 h', () => {
    expect(isBanner(allDay('2026-10-05', '2026-10-06'))).toBe(true)
    expect(isBanner(timed(new Date(2026, 9, 5, 9), new Date(2026, 9, 6, 10)))).toBe(true)
    expect(isBanner(timed(new Date(2026, 9, 5, 9), new Date(2026, 9, 5, 10)))).toBe(false)
  })

  it('Sortierung: Banner zuerst, dann Startzeit', () => {
    const late = timed(new Date(2026, 9, 5, 15), new Date(2026, 9, 5, 16))
    const early = timed(new Date(2026, 9, 5, 8), new Date(2026, 9, 5, 9))
    const banner = allDay('2026-10-05', '2026-10-06')
    const list = eventsByDay([late, early, banner], [new Date(2026, 9, 5)]).get('2026-10-05')
    expect(list?.map((e) => e.key)).toEqual([banner.key, early.key, late.key])
  })
})

describe('Bänder (ganztägig, mehrtägig)', () => {
  const week = daysFrom(new Date(2026, 9, 5), 7).map(dayKey)

  it('Spalten und Spuren', () => {
    const a = allDay('2026-10-06', '2026-10-09') // Di–Do
    const b = allDay('2026-10-07', '2026-10-08') // Mi (überlappt a)
    const c = allDay('2026-10-09', '2026-10-10') // Fr (frei in Spur 0)
    const { spans, lanes } = layoutSpans([b, c, a], week)
    expect(lanes).toBe(2)
    const s = new Map(spans.map((x) => [x.item.key, x]))
    expect(s.get(a.key)).toMatchObject({ startCol: 1, endCol: 4, lane: 0 })
    expect(s.get(b.key)).toMatchObject({ startCol: 2, endCol: 3, lane: 1 })
    expect(s.get(c.key)).toMatchObject({ startCol: 4, endCol: 5, lane: 0 })
  })

  it('Termine über die Wochengrenzen werden beschnitten und markiert', () => {
    const e = allDay('2026-10-02', '2026-10-20')
    const { spans } = layoutSpans([e], week)
    expect(spans[0]).toMatchObject({
      startCol: 0,
      endCol: 7,
      clippedStart: true,
      clippedEnd: true
    })
  })

  it('außerhalb der Woche: nicht enthalten; endDay exklusiv', () => {
    expect(layoutSpans([allDay('2026-09-28', '2026-10-05')], week).spans).toHaveLength(0)
    expect(layoutSpans([allDay('2026-10-12', '2026-10-13')], week).spans).toHaveLength(0)
    const { spans } = layoutSpans([allDay('2026-10-10', '2026-10-13')], week)
    expect(spans[0]).toMatchObject({ startCol: 5, endCol: 7, clippedEnd: true })
  })

  it('Mehrtägiger Zeittermin über Mitternacht', () => {
    const e = timed(new Date(2026, 9, 6, 22), new Date(2026, 9, 8, 22))
    const { spans } = layoutSpans([e], week)
    expect(spans[0]).toMatchObject({ startCol: 1, endCol: 4 })
  })
})

describe('Agenda', () => {
  const now = new Date(2026, 9, 5, 12, 0)

  it('Fenster heute + morgen', () => {
    const r = agendaRange(now)
    expect(r.start).toBe(new Date(2026, 9, 5).getTime())
    expect(r.end).toBe(new Date(2026, 9, 7).getTime())
  })

  it('beendete Termine fallen heute heraus, Ganztägiges bleibt, Abgesagtes nie', () => {
    const past = timed(new Date(2026, 9, 5, 8), new Date(2026, 9, 5, 9))
    const running = timed(new Date(2026, 9, 5, 11), new Date(2026, 9, 5, 13))
    const next = timed(new Date(2026, 9, 5, 15), new Date(2026, 9, 5, 16))
    const cancelled = timed(new Date(2026, 9, 5, 17), new Date(2026, 9, 5, 18), {
      status: 'CANCELLED'
    })
    const holiday = allDay('2026-10-05', '2026-10-06')
    const tomorrow = timed(new Date(2026, 9, 6, 9), new Date(2026, 9, 6, 10))
    const r = agendaItems([next, past, tomorrow, cancelled, running, holiday], now)
    expect(r.today.map((e) => e.key)).toEqual([holiday.key, running.key, next.key])
    expect(r.tomorrow.map((e) => e.key)).toEqual([tomorrow.key])
  })
})

describe('blockSpan', () => {
  it('gleich breite Spalten, solange sie lesbar bleiben', () => {
    expect(blockSpan(1, 2, 200)).toEqual({ left: 50, width: 50, cascade: false })
    expect(blockSpan(0, 1, 40)).toEqual({ left: 0, width: 100, cascade: false })
  })

  it('schmale Wochenspalte mit drei Überlappungen: gestaffelt statt 30-px-Streifen', () => {
    const a = blockSpan(0, 3, 92)
    const c = blockSpan(2, 3, 92)
    expect(a.cascade).toBe(true)
    expect(a.left).toBe(0)
    expect(a.width).toBeGreaterThan(60)
    // letzter Block schließt bündig mit der rechten Spaltenkante ab
    expect(c.left + c.width).toBeCloseTo(100)
    expect(c.left).toBeGreaterThan(a.left)
  })
})
