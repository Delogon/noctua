import { describe, expect, it } from 'vitest'
import {
  formatSuggestionWhen,
  formFromSuggestion
} from '@renderer/features/paper/event-suggestion-form'

const timed = {
  title: 'Projektgespräch',
  allDay: false,
  startLocal: '2026-10-07T14:00:00',
  endLocal: '2026-10-07T15:30:00',
  tzid: null,
  location: 'Büro',
  link: 'https://meet.example/x'
}

describe('formFromSuggestion (Bearbeiten…)', () => {
  it('belegt den Editor für einen Termin mit Uhrzeit vor', () => {
    const form = formFromSuggestion(timed, 5, 'Europe/Berlin')
    expect(form).toMatchObject({
      summary: 'Projektgespräch',
      location: 'Büro',
      description: 'https://meet.example/x',
      allDay: false,
      startDate: '2026-10-07',
      startTime: '14:00',
      endDate: '2026-10-07',
      endTime: '15:30',
      tzid: 'Europe/Berlin',
      calendarId: 5
    })
  })

  it('übernimmt eine genannte Zeitzone', () => {
    expect(
      formFromSuggestion({ ...timed, tzid: 'America/New_York' }, 1, 'Europe/Berlin').tzid
    ).toBe('America/New_York')
  })

  it('ganztägig: exklusives Ende wird zum inklusiven Formular-Enddatum', () => {
    const form = formFromSuggestion(
      { ...timed, allDay: true, startLocal: '2026-10-09', endLocal: '2026-10-11' },
      null,
      'Europe/Berlin'
    )
    expect(form).toMatchObject({ allDay: true, startDate: '2026-10-09', endDate: '2026-10-10' })
    const single = formFromSuggestion(
      { ...timed, allDay: true, startLocal: '2026-10-09', endLocal: '2026-10-10' },
      null,
      'Europe/Berlin'
    )
    expect(single.endDate).toBe('2026-10-09')
  })
})

describe('formatSuggestionWhen', () => {
  it('zeigt Wandzeit ohne Umrechnung', () => {
    const text = formatSuggestionWhen(timed, 'de', 'Europe/Berlin')
    expect(text).toContain('Mittwoch')
    expect(text).toContain('14:00 – 15:30')
  })

  it('nennt abweichende Zeitzone und „ganztägig"', () => {
    expect(
      formatSuggestionWhen({ ...timed, tzid: 'America/New_York' }, 'en', 'Europe/Berlin')
    ).toContain('(America/New_York)')
    expect(
      formatSuggestionWhen(
        { ...timed, allDay: true, startLocal: '2026-10-09', endLocal: '2026-10-10' },
        'de'
      )
    ).toContain('ganztägig')
  })
})
