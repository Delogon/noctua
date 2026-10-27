import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { formatListDate, formatFullDate } from '@renderer/lib/format'

// Fixed „now" timestamp for deterministic date output
const NOW = new Date('2026-07-03T12:00:00')

beforeAll(() => vi.setSystemTime(NOW))
afterAll(() => vi.useRealTimers())

describe('formatListDate', () => {
  it('zeigt für heute die Uhrzeit', () => {
    const today = new Date('2026-07-03T09:30:00').getTime()
    expect(formatListDate(today)).toMatch(/\d{2}:\d{2}/)
  })

  it('zeigt für dieses Jahr Tag und Monat', () => {
    const earlier = new Date('2026-05-12T09:30:00').getTime()
    const out = formatListDate(earlier)
    expect(out).toMatch(/12/)
    expect(out).not.toMatch(/:/)
  })

  it('zeigt für ältere Jahre ein numerisches Datum', () => {
    const old = new Date('2024-01-05T09:30:00').getTime()
    expect(formatListDate(old)).toMatch(/24/)
  })

  it('liefert leeren String für null', () => {
    expect(formatListDate(null)).toBe('')
  })
})

describe('formatFullDate', () => {
  it('formatiert ein vollständiges Datum', () => {
    const out = formatFullDate(new Date('2026-07-03T08:15:00').getTime())
    expect(out).toMatch(/2026/)
    expect(out).toMatch(/08:15|8:15/)
  })
  it('liefert leeren String für null', () => {
    expect(formatFullDate(null)).toBe('')
  })
})
