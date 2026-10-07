import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  asksForMeeting,
  buildAvailabilityBlock,
  computeFreeSlots,
  formatSlots,
  workingDayList
} from '@main/ai/availability'
import { createEvent, setCalendarChangedHandler } from '@main/calendar/service'
import { setSetting } from '@main/db'
import { closeTestDb, createTestDb } from '../helpers/db'

const Z = 'Europe/Berlin'
// Montag 2026-10-05 00:00 UTC (= 02:00 in Berlin, Sommerzeit)
const MON = Date.UTC(2026, 9, 5, 0, 0)
const h = (iso: string): number => Date.parse(iso)

describe('workingDayList', () => {
  it('überspringt Wochenenden', () => {
    // Freitag 2026-10-09 → Fr, Mo, Di
    const days = workingDayList(Date.UTC(2026, 9, 9, 10), Z, 3)
    expect(days.map((d) => `${d.y}-${d.m}-${d.d}`)).toEqual([
      '2026-10-9',
      '2026-10-12',
      '2026-10-13'
    ])
  })
})

describe('computeFreeSlots', () => {
  it('Arbeitszeit 08-18 lokal (Sommerzeit: 06:00-16:00Z), ohne Wochenende', () => {
    const slots = computeFreeSlots([], {
      fromUtc: Date.UTC(2026, 9, 9, 3), // Freitag früh
      zone: Z,
      workingDays: 2,
      leadMinutes: 0
    })
    expect(slots).toEqual([
      { startUtc: h('2026-10-09T06:00:00Z'), endUtc: h('2026-10-09T16:00:00Z') },
      { startUtc: h('2026-10-12T06:00:00Z'), endUtc: h('2026-10-12T16:00:00Z') }
    ])
  })

  it('zieht belegte Zeiten ab, verschmilzt Überlappungen, filtert zu kurze Lücken', () => {
    const slots = computeFreeSlots(
      [
        { startUtc: h('2026-10-05T08:00:00Z'), endUtc: h('2026-10-05T09:00:00Z') },
        { startUtc: h('2026-10-05T08:30:00Z'), endUtc: h('2026-10-05T10:00:00Z') }, // überlappt
        { startUtc: h('2026-10-05T10:10:00Z'), endUtc: h('2026-10-05T13:00:00Z') }, // 10-min-Lücke
        { startUtc: h('2026-10-05T15:00:00Z'), endUtc: h('2026-10-05T20:00:00Z') } // ragt über Ende
      ],
      { fromUtc: MON, zone: Z, workingDays: 1, leadMinutes: 0 }
    )
    expect(slots).toEqual([
      { startUtc: h('2026-10-05T06:00:00Z'), endUtc: h('2026-10-05T08:00:00Z') },
      { startUtc: h('2026-10-05T13:00:00Z'), endUtc: h('2026-10-05T15:00:00Z') }
    ])
  })

  it('ganztägig belegter Tag liefert nichts', () => {
    const slots = computeFreeSlots(
      [{ startUtc: h('2026-10-05T00:00:00Z'), endUtc: h('2026-10-06T00:00:00Z') }],
      { fromUtc: MON, zone: Z, workingDays: 1, leadMinutes: 0 }
    )
    expect(slots).toEqual([])
  })

  it('Vorlauf und laufender Tag: nichts in der Vergangenheit, auf 15 min aufgerundet', () => {
    const slots = computeFreeSlots([], {
      fromUtc: h('2026-10-05T08:07:00Z'), // 10:07 lokal
      zone: Z,
      workingDays: 1,
      leadMinutes: 60
    })
    expect(slots).toEqual([
      { startUtc: h('2026-10-05T09:15:00Z'), endUtc: h('2026-10-05T16:00:00Z') }
    ])
  })

  it('Zeitumstellung: Arbeitszeit bleibt 08-18 lokal vor und nach dem Wechsel (25.10.2026)', () => {
    // Fr 23.10. (CEST, +2) und Mo 26.10. (CET, +1)
    const slots = computeFreeSlots([], {
      fromUtc: h('2026-10-23T00:00:00Z'),
      zone: Z,
      workingDays: 2,
      leadMinutes: 0
    })
    expect(slots[0]).toEqual({
      startUtc: h('2026-10-23T06:00:00Z'),
      endUtc: h('2026-10-23T16:00:00Z')
    })
    expect(slots[1]).toEqual({
      startUtc: h('2026-10-26T07:00:00Z'),
      endUtc: h('2026-10-26T17:00:00Z')
    })
  })

  it('Frühjahrs-Umstellung (29.03.2026) verschiebt die Montags-Fenster', () => {
    const slots = computeFreeSlots([], {
      fromUtc: h('2026-03-27T00:00:00Z'), // Freitag, CET
      zone: Z,
      workingDays: 2,
      leadMinutes: 0
    })
    expect(slots[0].startUtc).toBe(h('2026-03-27T07:00:00Z'))
    expect(slots[1].startUtc).toBe(h('2026-03-30T06:00:00Z')) // CEST
  })
})

describe('formatSlots', () => {
  it('ein Tag je Zeile in lokaler Zeit', () => {
    const lines = formatSlots(
      [
        { startUtc: h('2026-10-05T06:00:00Z'), endUtc: h('2026-10-05T08:00:00Z') },
        { startUtc: h('2026-10-05T13:00:00Z'), endUtc: h('2026-10-05T15:00:00Z') },
        { startUtc: h('2026-10-06T06:00:00Z'), endUtc: h('2026-10-06T16:00:00Z') }
      ],
      Z
    )
    expect(lines).toEqual([
      '2026-10-05 (Mon): 08:00-10:00, 15:00-17:00',
      '2026-10-06 (Tue): 08:00-18:00'
    ])
  })
})

describe('asksForMeeting', () => {
  it('erkennt Terminanfragen (DE/EN) oder vorhandene Terminvorschläge', () => {
    expect(asksForMeeting('Hast du nächste Woche Zeit für ein Treffen?', false)).toBe(true)
    expect(asksForMeeting('Could we schedule a call?', false)).toBe(true)
    expect(asksForMeeting('Danke für die Rechnung.', false)).toBe(false)
    expect(asksForMeeting('Danke für die Rechnung.', true)).toBe(true)
  })
})

describe('buildAvailabilityBlock', () => {
  let db: Database.Database
  let calId: number
  const NOW = h('2026-10-05T05:00:00Z') // Montag 07:00 Berlin

  beforeEach(() => {
    db = createTestDb()
    setCalendarChangedHandler(() => {})
  })
  afterEach(() => {
    setCalendarChangedHandler(() => {})
    closeTestDb(db)
  })

  function addCalendar(): void {
    const acc = Number(
      db
        .prepare(
          `INSERT INTO cal_accounts (name, server_url, home_url, username, created_at)
           VALUES ('T', 'https://x.test/', 'https://x.test/cal/', 'u', 1)`
        )
        .run().lastInsertRowid
    )
    calId = Number(
      db
        .prepare(
          `INSERT INTO calendars (account_id, url, display_name, components)
           VALUES (?, 'https://x.test/cal/p/', 'P', 'VEVENT')`
        )
        .run(acc).lastInsertRowid
    )
  }

  function busyEvent(summary: string, start: string, end: string): void {
    createEvent(
      {
        calendarId: calId,
        summary,
        location: 'Praxis Dr. Geheim',
        description: 'vertraulich',
        time: { allDay: false, start, end, tzid: 'Europe/Berlin' },
        rrule: null,
        status: null,
        transparency: null,
        alarms: [],
        attendees: [],
        organizer: null
      },
      db
    )
  }

  const input = {
    now: NOW,
    zone: Z,
    lastMessageText: 'Hast du Zeit für ein Treffen?',
    hasEventSuggestion: false
  }

  it('enthält nur freie Zeitfenster, keine Titel/Orte/Beschreibungen', () => {
    addCalendar()
    busyEvent('Chemotherapie bei Dr. Geheim', '2026-10-06T08:00:00', '2026-10-06T12:00:00')
    const block = buildAvailabilityBlock(db, input)!
    expect(block).toContain('<<<BEGIN FREIE ZEITFENSTER>>>')
    // Dienstag: 08-12 belegt → frei erst ab 12:00
    expect(block).toContain('2026-10-06 (Tue): 12:00-18:00')
    expect(block).toContain('2026-10-05 (Mon): 09:00-18:00') // 07:00 + 2 h Vorlauf
    expect(block).not.toMatch(/Chemo|Geheim|Praxis|vertraulich/)
  })

  it('Setting aus → keine Kalenderdaten', () => {
    addCalendar()
    busyEvent('X', '2026-10-06T08:00:00', '2026-10-06T12:00:00')
    setSetting('ai.draftUseCalendar', '0')
    expect(buildAvailabilityBlock(db, input)).toBeNull()
  })

  it('kein Kalender-Konto → null; Mail ohne Terminbezug → null', () => {
    expect(buildAvailabilityBlock(db, input)).toBeNull()
    addCalendar()
    expect(
      buildAvailabilityBlock(db, { ...input, lastMessageText: 'Danke für die Rechnung.' })
    ).toBeNull()
    expect(
      buildAvailabilityBlock(db, { ...input, lastMessageText: 'Danke.', hasEventSuggestion: true })
    ).not.toBeNull()
  })

  it('komplett belegt → Hinweis ohne Slots', () => {
    addCalendar()
    for (const d of ['05', '06', '07', '08', '09', '12', '13', '14', '15', '16']) {
      busyEvent('Block', `2026-10-${d}T00:00:00`, `2026-10-${d}T23:59:00`)
    }
    const block = buildAvailabilityBlock(db, input)!
    expect(block).toContain('keine freien Zeitfenster')
    expect(block).not.toContain('<<<BEGIN')
  })
})
