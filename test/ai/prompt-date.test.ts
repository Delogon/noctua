import { describe, it, expect } from 'vitest'
import { currentDateLine, localStamp } from '@main/ai/prompt-date'

describe('currentDateLine', () => {
  it('nennt Wochentag, lesbares Datum, ISO-Form und Uhrzeit', () => {
    const line = currentDateLine(new Date(2026, 6, 16, 9, 5))
    expect(line).toBe('Today is Thursday, 16 July 2026 (2026-07-16), 09:05.')
  })

  it('nutzt lokale Zeit, nicht UTC (Mitternachts-Grenze)', () => {
    // 00:30 local on January 1 — in UTC this may still be the previous day
    const line = currentDateLine(new Date(2027, 0, 1, 0, 30))
    expect(line).toContain('(2027-01-01)')
    expect(line).toContain('1 January 2027')
  })
})

describe('localStamp', () => {
  it('formatiert in der angegebenen Zeitzone statt UTC', () => {
    // 2026-07-15T22:01Z = 16.07. 00:01 in Berlin — UTC would have the wrong date
    const ts = Date.UTC(2026, 6, 15, 22, 1)
    expect(localStamp(ts, 'Europe/Berlin')).toBe('2026-07-16 00:01')
    expect(localStamp(ts, 'UTC')).toBe('2026-07-15 22:01')
  })

  it('akzeptiert Date-Objekte', () => {
    expect(localStamp(new Date(Date.UTC(2026, 0, 5, 9, 30)), 'Europe/Berlin')).toBe(
      '2026-01-05 10:30'
    )
  })
})
