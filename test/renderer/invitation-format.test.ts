import { describe, expect, it } from 'vitest'
import {
  formatInvitationWhen,
  recurrenceSummary
} from '../../src/renderer/src/features/paper/invitation-format'

describe('Einladungs-Darstellung', () => {
  it('Zeit in der Zielzone, gleicher Tag mit Zeitspanne', () => {
    const text = formatInvitationWhen(
      {
        startUtc: Date.UTC(2026, 9, 20, 8, 0),
        endUtc: Date.UTC(2026, 9, 20, 9, 0),
        allDay: false,
        startDay: null,
        endDay: null
      },
      'de',
      'Europe/Berlin'
    )
    expect(text).toContain('Dienstag, 20. Oktober 2026')
    expect(text).toContain('10:00 – 11:00')
  })

  it('ganztägig: Kalendertage, Ende exklusiv, nie zeitzonenverschoben', () => {
    const when = {
      startUtc: Date.UTC(2026, 10, 3),
      endUtc: Date.UTC(2026, 10, 5),
      allDay: true,
      startDay: '2026-11-03',
      endDay: '2026-11-05'
    }
    const text = formatInvitationWhen(when, 'en', 'America/Los_Angeles')
    expect(text).toContain('3 November 2026')
    expect(text).toContain('4 November 2026')
    expect(text).not.toContain('5 November')
    expect(text).toContain('all day')
  })

  it('Wiederholung in Klartext', () => {
    expect(recurrenceSummary('FREQ=WEEKLY;BYDAY=TU', 'de')).toBe('Jede Woche (Dienstag)')
    expect(recurrenceSummary('FREQ=DAILY;INTERVAL=2;COUNT=5', 'en')).toBe('Every 2 days, 5 times')
    expect(recurrenceSummary('FREQ=SECONDLY', 'en')).toBe('Recurring')
    expect(recurrenceSummary(null, 'de')).toBeNull()
  })
})
