import { describe, expect, it } from 'vitest'
import {
  conflictsWith,
  findCommonFreeSlot,
  mergeIntervals,
  stripSegments,
  wallToLocalMs,
  workingDayStarts
} from '@renderer/features/calendar/free-slots'

// Lokale Zeit (wie die Implementierung): Mo 5.10.2026 ist ein Montag.
const L = (d: number, h: number, m = 0): number => new Date(2026, 9, d, h, m).getTime()
const iv = (d: number, h1: number, h2: number): { startUtc: number; endUtc: number } => ({
  startUtc: L(d, h1),
  endUtc: L(d, h2)
})
const HOUR = 3_600_000

describe('mergeIntervals', () => {
  it('sortiert, verschmilzt Überlappung und Berührung, verwirft leere', () => {
    expect(
      mergeIntervals([iv(5, 10, 11), iv(5, 9, 10), iv(5, 13, 14), iv(5, 12, 12), iv(5, 10, 10)])
    ).toEqual([iv(5, 9, 11), iv(5, 13, 14)])
  })
})

describe('workingDayStarts', () => {
  it('überspringt das Wochenende', () => {
    // Fr 9.10. + Mo 12.10. + Di 13.10.
    const days = workingDayStarts(L(9, 15), 3)
    expect(days.map((d) => new Date(d).getDate())).toEqual([9, 12, 13])
  })
})

describe('findCommonFreeSlot', () => {
  it('erstes Fenster, in dem alle frei sind (Raster 15 min)', () => {
    const slot = findCommonFreeSlot({
      busy: [[iv(5, 8, 10)], [iv(5, 9, 11)], []],
      durationMs: HOUR,
      fromMs: L(5, 7)
    })
    expect(slot).toEqual({ startUtc: L(5, 11), endUtc: L(5, 12) })
  })

  it('nie vor fromMs, auf die nächste Viertelstunde aufgerundet', () => {
    const slot = findCommonFreeSlot({ busy: [[]], durationMs: HOUR, fromMs: L(5, 9, 5) })
    expect(slot?.startUtc).toBe(L(5, 9, 15))
  })

  it('Lücken zwischen Terminen werden genutzt, zu kurze nicht', () => {
    const slot = findCommonFreeSlot({
      busy: [[iv(5, 8, 9), { startUtc: L(5, 9, 30), endUtc: L(5, 18) }]],
      durationMs: HOUR,
      fromMs: L(5, 7)
    })
    // 09:00-09:30 ist zu kurz, Montag danach belegt → Dienstag 08:00
    expect(slot).toEqual({ startUtc: L(6, 8), endUtc: L(6, 9) })
  })

  it('springt über das Wochenende', () => {
    const slot = findCommonFreeSlot({
      busy: [[iv(9, 8, 18)]], // Freitag komplett belegt
      durationMs: HOUR,
      fromMs: L(9, 7)
    })
    expect(slot).toEqual({ startUtc: L(12, 8), endUtc: L(12, 9) })
  })

  it('nach Arbeitsende: nächster Arbeitstag', () => {
    const slot = findCommonFreeSlot({ busy: [[]], durationMs: HOUR, fromMs: L(5, 18, 30) })
    expect(slot).toEqual({ startUtc: L(6, 8), endUtc: L(6, 9) })
  })

  it('nichts frei innerhalb der Arbeitstage oder Dauer zu lang: null', () => {
    const busy = [0, 1, 2, 3, 4, 7, 8, 9, 10, 11].map((i) => {
      const day = new Date(2026, 9, 5 + i)
      return {
        startUtc: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0).getTime(),
        endUtc: new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, 0).getTime()
      }
    })
    expect(findCommonFreeSlot({ busy: [busy], durationMs: HOUR, fromMs: L(5, 7) })).toBeNull()
    expect(findCommonFreeSlot({ busy: [[]], durationMs: 11 * HOUR, fromMs: L(5, 7) })).toBeNull()
    expect(findCommonFreeSlot({ busy: [[]], durationMs: 0, fromMs: L(5, 7) })).toBeNull()
  })

  it('Fenster ganz knapp vor Arbeitsende passt', () => {
    const slot = findCommonFreeSlot({
      busy: [[iv(5, 8, 17)]],
      durationMs: HOUR,
      fromMs: L(5, 7)
    })
    expect(slot).toEqual({ startUtc: L(5, 17), endUtc: L(5, 18) })
  })
})

describe('stripSegments', () => {
  it('Anteile am Fenster 08-20, beschnitten, vorläufig markiert', () => {
    const segs = stripSegments(
      [
        { ...iv(5, 6, 9), type: 'BUSY' },
        { ...iv(5, 14, 16), type: 'BUSY-TENTATIVE' },
        iv(5, 21, 22)
      ],
      L(5, 8),
      L(5, 20)
    )
    expect(segs).toHaveLength(2)
    expect(segs[0]).toEqual({ from: 0, to: 1 / 12, tentative: false })
    expect(segs[1].from).toBeCloseTo(0.5)
    expect(segs[1].to).toBeCloseTo(8 / 12)
    expect(segs[1].tentative).toBe(true)
  })
})

describe('Hilfen', () => {
  it('conflictsWith und wallToLocalMs', () => {
    expect(conflictsWith([iv(5, 9, 10)], iv(5, 9, 11))).toBe(true)
    expect(conflictsWith([iv(5, 9, 10)], iv(5, 10, 11))).toBe(false)
    expect(wallToLocalMs('2026-10-05', '09:30')).toBe(L(5, 9, 30))
    expect(wallToLocalMs('2026-10-05', '9:30')).toBeNaN()
  })
})
