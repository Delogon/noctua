import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  dayKey,
  diffDays,
  isoWeek,
  monthGrid,
  nextFullHour,
  parseDayKey,
  parseTimeInput,
  shiftAnchor,
  startOfWeek,
  utcToWall,
  visibleRange,
  viewDays,
  wallToUtc
} from '@renderer/features/calendar/dates'

// Zeitzone vor dem Sammeln der Tests setzen (Modul-Konstanten mit Date)
process.env.TZ = 'Europe/Berlin'

describe('Wochenberechnung (Montag, DST-sicher)', () => {
  it('Woche beginnt am Montag', () => {
    // Mittwoch, 7. Oktober 2026
    const start = startOfWeek(new Date(2026, 9, 7, 15, 30))
    expect(dayKey(start)).toBe('2026-10-05')
    expect(start.getHours()).toBe(0)
  })

  it('Sonntag gehört zur Woche davor', () => {
    expect(dayKey(startOfWeek(new Date(2026, 9, 11)))).toBe('2026-10-05')
    expect(dayKey(startOfWeek(new Date(2026, 9, 12)))).toBe('2026-10-12')
  })

  it('Woche mit Zeitumstellung (Sommerzeit-Ende 25.10.2026) hat 7 Kalendertage', () => {
    const range = visibleRange('week', new Date(2026, 9, 25))
    expect(dayKey(range.start)).toBe('2026-10-19')
    expect(dayKey(range.end)).toBe('2026-10-26')
    // 25-h-Tag: Differenz in ms ist NICHT 7 × 24 h, aber die Tage stimmen
    expect(range.end.getTime() - range.start.getTime()).toBe(7 * 86_400_000 + 3_600_000)
    expect(viewDays('week', new Date(2026, 9, 25)).map(dayKey)).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25'
    ])
  })

  it('Frühlings-Umstellung (29.03.2026): addDays bleibt auf Mitternacht', () => {
    const d = addDays(new Date(2026, 2, 28, 0, 0), 1)
    expect(dayKey(d)).toBe('2026-03-29')
    expect(d.getHours()).toBe(0)
    expect(dayKey(addDays(d, 1))).toBe('2026-03-30')
    expect(diffDays(new Date(2026, 2, 28), new Date(2026, 2, 30))).toBe(2)
  })

  it('Tagesansicht und Periodenwechsel', () => {
    const a = new Date(2026, 9, 5)
    expect(visibleRange('day', a).end.getTime()).toBe(addDays(a, 1).getTime())
    expect(dayKey(shiftAnchor('day', a, -1))).toBe('2026-10-04')
    expect(dayKey(shiftAnchor('week', a, 1))).toBe('2026-10-12')
    expect(dayKey(shiftAnchor('month', new Date(2026, 0, 31), 1))).toBe('2026-02-28')
  })

  it('ISO-Kalenderwoche', () => {
    expect(isoWeek(new Date(2026, 9, 5))).toBe(41)
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1)
    expect(isoWeek(new Date(2027, 0, 1))).toBe(53)
  })
})

describe('Monatsraster', () => {
  it('Oktober 2026: 5 Wochen, beginnt Mo 28.09.', () => {
    const grid = monthGrid(new Date(2026, 9, 15))
    expect(grid).toHaveLength(5)
    expect(dayKey(grid[0][0])).toBe('2026-09-28')
    expect(dayKey(grid[4][6])).toBe('2026-11-01')
    expect(grid.every((w) => w.length === 7)).toBe(true)
  })

  it('Februar 2027 (Mo-Start, 28 Tage) = 4 Zeilen', () => {
    const grid = monthGrid(new Date(2027, 1, 10))
    expect(grid).toHaveLength(4)
    expect(dayKey(grid[0][0])).toBe('2027-02-01')
  })

  it('März 2026 mit Zeitumstellung: lückenlose Tage', () => {
    const flat = monthGrid(new Date(2026, 2, 10)).flat()
    for (let i = 1; i < flat.length; i++) expect(diffDays(flat[i - 1], flat[i])).toBe(1)
    expect(flat.map(dayKey)).toContain('2026-03-29')
  })

  it('addMonths kürzt auf Monatsende', () => {
    expect(dayKey(addMonths(new Date(2026, 7, 31), 1))).toBe('2026-09-30')
  })
})

describe('Zeitzonen-Umrechnung', () => {
  it('Wandzeit ↔ UTC in Europe/Berlin', () => {
    const wall = '2026-07-01T12:00:00'
    const ms = wallToUtc(wall, 'Europe/Berlin')
    expect(new Date(ms).toISOString()).toBe('2026-07-01T10:00:00.000Z')
    expect(utcToWall(ms, 'Europe/Berlin')).toBe(wall)
  })

  it('andere Zone und Winterzeit', () => {
    const ms = wallToUtc('2026-01-15T09:30:00', 'America/New_York')
    expect(new Date(ms).toISOString()).toBe('2026-01-15T14:30:00.000Z')
  })

  it('Lücke der Frühlings-Umstellung ergibt einen gültigen Zeitpunkt', () => {
    const ms = wallToUtc('2026-03-29T02:30:00', 'Europe/Berlin')
    expect(Number.isFinite(ms)).toBe(true)
  })
})

describe('Eingabe-Helfer', () => {
  it('parseTimeInput', () => {
    expect(parseTimeInput('9')).toBe('09:00')
    expect(parseTimeInput('930')).toBe('09:30')
    expect(parseTimeInput('9.5')).toBe('09:05')
    expect(parseTimeInput('18:45')).toBe('18:45')
    expect(parseTimeInput('24:00')).toBeNull()
    expect(parseTimeInput('abc')).toBeNull()
    expect(parseTimeInput('')).toBeNull()
  })

  it('nextFullHour und parseDayKey', () => {
    const n = nextFullHour(new Date(2026, 9, 5, 14, 20))
    expect(n.getHours()).toBe(15)
    expect(n.getMinutes()).toBe(0)
    expect(dayKey(parseDayKey('2026-10-05'))).toBe('2026-10-05')
  })
})
