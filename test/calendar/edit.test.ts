import { describe, expect, it } from 'vitest'
import { createEventIcs, deleteFromIcs, updateIcs, type EditContext } from '@main/calendar/edit'
import {
  expandResource,
  extractObjectFields,
  parseCalendar,
  readFields,
  splitComponents,
  vtimezonesOf
} from '@main/calendar/ics'
import type { CalendarEventFields } from '@shared/calendar-types'

const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')
let uidSeq = 0
const ctx = (): EditContext => ({
  now: Date.parse('2025-06-01T12:00:00Z'),
  newUid: () => `new-${++uidSeq}@test`
})

const base = (over: Partial<CalendarEventFields> = {}): CalendarEventFields => ({
  summary: 'Team-Meeting',
  location: 'Raum 4',
  description: 'Agenda, Punkte; mehrere\nZeilen',
  time: {
    allDay: false,
    start: '2025-03-24T09:00:00',
    end: '2025-03-24T10:00:00',
    tzid: 'Europe/Berlin'
  },
  rrule: null,
  status: null,
  transparency: null,
  alarms: [],
  attendees: [],
  organizer: null,
  ...over
})

const win = (
  ics: string,
  from = '2025-03-01T00:00:00Z',
  to = '2025-06-01T00:00:00Z'
): ReturnType<typeof expandResource> =>
  expandResource(parseCalendar(ics), { windowStart: Date.parse(from), windowEnd: Date.parse(to) })

describe('createEventIcs', () => {
  it('erzeugt gültiges ICS mit VTIMEZONE, UID und Roundtrip der Felder', () => {
    const { ics, uid } = createEventIcs(
      base({
        alarms: [
          {
            action: 'DISPLAY',
            relativeTo: 'START',
            offsetSeconds: -600,
            absoluteUtc: null,
            description: null
          }
        ],
        attendees: [
          {
            email: 'bob@example.com',
            name: 'Bob',
            role: 'REQ-PARTICIPANT',
            partstat: 'NEEDS-ACTION',
            rsvp: true,
            cutype: 'INDIVIDUAL'
          }
        ],
        organizer: { email: 'anna@example.com', name: 'Anna' },
        status: 'CONFIRMED'
      }),
      ctx()
    )
    expect(uid).toMatch(/@test$/)
    expect(ics).toContain('BEGIN:VTIMEZONE')
    expect(ics).toContain('DTSTART;TZID=Europe/Berlin:20250324T090000')
    expect(ics).toContain('PRODID:-//Noctua//')
    expect(ics.endsWith('\r\n')).toBe(true)
    const root = parseCalendar(ics)
    const fields = readFields(splitComponents(root).master!, vtimezonesOf(root))
    expect(fields.summary).toBe('Team-Meeting')
    expect(fields.description).toBe('Agenda, Punkte; mehrere\nZeilen')
    expect(fields.time).toEqual(base().time)
    expect(fields.alarms[0].offsetSeconds).toBe(-600)
    expect(fields.attendees[0].email).toBe('bob@example.com')
    expect(fields.organizer?.name).toBe('Anna')
    expect(fields.status).toBe('CONFIRMED')
    expect(extractObjectFields(root).uid).toBe(uid)
  })

  it('ganztägig (DATE, Ende exklusiv) und UTC (Z)', () => {
    const allDay = createEventIcs(
      base({ time: { allDay: true, start: '2025-04-01', end: '2025-04-03', tzid: null } }),
      ctx()
    ).ics
    expect(allDay).toContain('DTSTART;VALUE=DATE:20250401')
    expect(allDay).toContain('DTEND;VALUE=DATE:20250403')
    expect(allDay).not.toContain('VTIMEZONE')
    const utc = createEventIcs(
      base({
        time: {
          allDay: false,
          start: '2025-04-01T10:00:00',
          end: '2025-04-01T11:00:00',
          tzid: 'UTC'
        }
      }),
      ctx()
    ).ics
    expect(utc).toContain('DTSTART:20250401T100000Z')
    const floating = createEventIcs(
      base({
        time: {
          allDay: false,
          start: '2025-04-01T10:00:00',
          end: '2025-04-01T11:00:00',
          tzid: null
        }
      }),
      ctx()
    ).ics
    expect(floating).toContain('DTSTART:20250401T100000\r\n')
  })

  it('lehnt Ende vor Beginn und ungültige RRULE ab', () => {
    expect(() =>
      createEventIcs(
        base({
          time: {
            allDay: false,
            start: '2025-04-01T11:00:00',
            end: '2025-04-01T10:00:00',
            tzid: 'UTC'
          }
        }),
        ctx()
      )
    ).toThrow(/Ende/)
    expect(() => createEventIcs(base({ rrule: 'NONSENSE' }), ctx())).toThrow(/Wiederholungsregel/)
  })
})

describe('updateIcs', () => {
  const series = (): string => createEventIcs(base({ rrule: 'FREQ=WEEKLY;COUNT=6' }), ctx()).ics // Mo 24.3., 31.3., 7.4., …

  it('nicht wiederkehrend: Änderung, SEQUENCE steigt, Felder bleiben', () => {
    const { ics } = createEventIcs(base(), ctx())
    const res = updateIcs(
      ics,
      { scope: 'all', recurrenceId: null, patch: { summary: 'Neu', location: null } },
      ctx()
    )
    const root = parseCalendar(res.ics)
    const f = readFields(splitComponents(root).master!, vtimezonesOf(root))
    expect(f.summary).toBe('Neu')
    expect(f.location).toBeNull()
    expect(f.description).toContain('Agenda')
    expect(extractObjectFields(root).sequence).toBe(1)
  })

  it('"alle": Zeitänderung der Serie verschiebt alle Vorkommen und räumt Ausnahmen auf', () => {
    const first = updateIcs(
      series(),
      { scope: 'this', recurrenceId: '2025-03-31T07:00:00Z', patch: { summary: 'Ausnahme' } },
      ctx()
    )
    expect(first.ics).toContain('RECURRENCE-ID')
    const res = updateIcs(
      first.ics,
      {
        scope: 'all',
        recurrenceId: null,
        patch: {
          time: {
            allDay: false,
            start: '2025-03-24T11:00:00',
            end: '2025-03-24T12:00:00',
            tzid: 'Europe/Berlin'
          }
        }
      },
      ctx()
    )
    expect(res.ics).not.toContain('RECURRENCE-ID')
    const occ = win(res.ics)
    expect(occ).toHaveLength(6)
    expect(iso(occ[0].startUtc)).toBe('2025-03-24T10:00:00Z')
    expect(iso(occ[2].startUtc)).toBe('2025-04-07T09:00:00Z') // Sommerzeit
  })

  it('"alle": Titeländerung behält Ausnahmen', () => {
    const first = updateIcs(
      series(),
      { scope: 'this', recurrenceId: '2025-03-31T07:00:00Z', patch: { summary: 'Ausnahme' } },
      ctx()
    )
    const res = updateIcs(
      first.ics,
      { scope: 'all', recurrenceId: null, patch: { summary: 'Serie neu' } },
      ctx()
    )
    expect(res.ics).toContain('RECURRENCE-ID')
    const occ = win(res.ics)
    expect(occ.find((o) => o.isOverride)!.comp.getFirstPropertyValue('summary')).toBe('Ausnahme')
  })

  it('"dieses": legt RECURRENCE-ID-Override an und ändert nur dieses Vorkommen', () => {
    const res = updateIcs(
      series(),
      {
        scope: 'this',
        recurrenceId: '2025-04-07T07:00:00Z',
        patch: {
          summary: 'Verschoben',
          time: {
            allDay: false,
            start: '2025-04-07T15:00:00',
            end: '2025-04-07T16:30:00',
            tzid: 'Europe/Berlin'
          }
        }
      },
      ctx()
    )
    expect(res.created).toBeNull()
    const root = parseCalendar(res.ics)
    expect(root.getAllSubcomponents('vevent')).toHaveLength(2)
    expect(res.ics).toContain('RECURRENCE-ID;TZID=Europe/Berlin:20250407T090000')
    const occ = win(res.ics)
    expect(occ).toHaveLength(6)
    const ov = occ.find((o) => o.isOverride)!
    expect(iso(ov.startUtc)).toBe('2025-04-07T13:00:00Z')
    expect(iso(ov.endUtc)).toBe('2025-04-07T14:30:00Z')
    // Override trägt keine Wiederholung
    expect(ov.comp.hasProperty('rrule')).toBe(false)
    // erneutes Ändern desselben Vorkommens aktualisiert den vorhandenen Override
    const again = updateIcs(
      res.ics,
      { scope: 'this', recurrenceId: '2025-04-07T07:00:00Z', patch: { location: 'Anderswo' } },
      ctx()
    )
    expect(parseCalendar(again.ics).getAllSubcomponents('vevent')).toHaveLength(2)
    expect(again.ics).toContain('LOCATION:Anderswo')
  })

  it('"dieses" auf ein nicht existierendes Vorkommen wirft', () => {
    expect(() =>
      updateIcs(
        series(),
        { scope: 'this', recurrenceId: '2025-03-25T07:00:00Z', patch: { summary: 'x' } },
        ctx()
      )
    ).toThrow(/Vorkommen/)
  })

  it('"dieses und folgende": Serie wird geteilt (UNTIL + neue UID, COUNT-Rest)', () => {
    const res = updateIcs(
      series(),
      {
        scope: 'following',
        recurrenceId: '2025-04-07T07:00:00Z',
        patch: {
          summary: 'Ab jetzt',
          time: {
            allDay: false,
            start: '2025-04-07T10:00:00',
            end: '2025-04-07T11:00:00',
            tzid: 'Europe/Berlin'
          }
        }
      },
      ctx()
    )
    expect(res.created).not.toBeNull()
    // Ursprung: 24.3. und 31.3., endet davor
    const orig = win(res.ics, '2025-03-01T00:00:00Z', '2025-08-01T00:00:00Z')
    expect(orig.map((o) => iso(o.startUtc))).toEqual([
      '2025-03-24T08:00:00Z',
      '2025-03-31T07:00:00Z'
    ])
    expect(res.ics).toMatch(/UNTIL=20250407T065959Z/)
    expect(res.ics).not.toContain('COUNT=')
    // Neue Serie: 4 verbleibende Vorkommen ab 7.4., 10:00 lokal
    const created = win(res.created!.ics, '2025-03-01T00:00:00Z', '2025-08-01T00:00:00Z')
    expect(created.map((o) => iso(o.startUtc))).toEqual([
      '2025-04-07T08:00:00Z',
      '2025-04-14T08:00:00Z',
      '2025-04-21T08:00:00Z',
      '2025-04-28T08:00:00Z'
    ])
    expect(res.created!.ics).toContain('UID:' + res.created!.uid)
    expect(res.created!.uid).not.toBe(extractObjectFields(parseCalendar(res.ics)).uid)
    expect(res.created!.ics).toContain('SUMMARY:Ab jetzt')
    expect(res.created!.ics).toContain('BEGIN:VTIMEZONE')
  })

  it('"folgende" ab dem ersten Vorkommen = ganze Serie; Ausnahmen/EXDATE wandern mit', () => {
    const all = updateIcs(
      series(),
      { scope: 'following', recurrenceId: '2025-03-24T08:00:00Z', patch: { summary: 'Alle' } },
      ctx()
    )
    expect(all.created).toBeNull()

    let ics = updateIcs(
      series(),
      { scope: 'this', recurrenceId: '2025-04-14T07:00:00Z', patch: { summary: 'Sonder' } },
      ctx()
    ).ics
    ics =
      deleteFromIcs(ics, { scope: 'this', recurrenceId: '2025-04-21T07:00:00Z' }, ctx()).kind ===
      'update'
        ? (
            deleteFromIcs(ics, { scope: 'this', recurrenceId: '2025-04-21T07:00:00Z' }, ctx()) as {
              ics: string
            }
          ).ics
        : ics
    const split = updateIcs(
      ics,
      { scope: 'following', recurrenceId: '2025-04-07T07:00:00Z', patch: { location: 'Neu' } },
      ctx()
    )
    expect(split.ics).not.toContain('RECURRENCE-ID')
    expect(split.ics).not.toContain('EXDATE')
    expect(split.created!.ics).toContain('RECURRENCE-ID')
    expect(split.created!.ics).toContain('EXDATE')
    const moved = parseCalendar(split.created!.ics)
    for (const v of moved.getAllSubcomponents('vevent')) {
      expect(v.getFirstPropertyValue('uid')).toBe(split.created!.uid)
    }
  })
})

describe('deleteFromIcs', () => {
  const series = (): string => createEventIcs(base({ rrule: 'FREQ=DAILY;COUNT=5' }), ctx()).ics

  it('nicht wiederkehrend oder "alle" löscht die Ressource', () => {
    expect(
      deleteFromIcs(createEventIcs(base(), ctx()).ics, { scope: 'all', recurrenceId: null }).kind
    ).toBe('delete')
    expect(deleteFromIcs(series(), { scope: 'all', recurrenceId: null }).kind).toBe('delete')
  })

  it('"dieses": EXDATE, Override entfernt', () => {
    const withOv = updateIcs(
      series(),
      { scope: 'this', recurrenceId: '2025-03-25T08:00:00Z', patch: { summary: 'X' } },
      ctx()
    ).ics
    const res = deleteFromIcs(
      withOv,
      { scope: 'this', recurrenceId: '2025-03-25T08:00:00Z' },
      ctx()
    )
    expect(res.kind).toBe('update')
    const ics = (res as { ics: string }).ics
    expect(ics).toContain('EXDATE;TZID=Europe/Berlin:20250325T090000')
    expect(ics).not.toContain('RECURRENCE-ID')
    const occ = win(ics)
    expect(occ).toHaveLength(4)
    expect(occ.map((o) => o.recurrenceId)).not.toContain('2025-03-25T08:00:00Z')
  })

  it('"dieses und folgende": UNTIL; erstes Vorkommen löscht alles', () => {
    const res = deleteFromIcs(
      series(),
      { scope: 'following', recurrenceId: '2025-03-27T08:00:00Z' },
      ctx()
    )
    const ics = (res as { ics: string }).ics
    expect(win(ics)).toHaveLength(3)
    expect(ics).toContain('UNTIL=20250327T075959Z')
    expect(
      deleteFromIcs(series(), { scope: 'following', recurrenceId: '2025-03-24T08:00:00Z' }).kind
    ).toBe('delete')
  })

  it('ganztägige Serie: EXDATE als DATE, UNTIL als DATE', () => {
    const ad = createEventIcs(
      base({
        time: { allDay: true, start: '2025-04-01', end: '2025-04-02', tzid: null },
        rrule: 'FREQ=DAILY;COUNT=5'
      }),
      ctx()
    ).ics
    const ex = deleteFromIcs(ad, { scope: 'this', recurrenceId: '2025-04-02' }, ctx()) as {
      ics: string
    }
    expect(ex.ics).toContain('EXDATE;VALUE=DATE:20250402')
    expect(win(ex.ics, '2025-04-01T00:00:00Z', '2025-05-01T00:00:00Z')).toHaveLength(4)
    const fol = deleteFromIcs(ad, { scope: 'following', recurrenceId: '2025-04-04' }, ctx()) as {
      ics: string
    }
    expect(fol.ics).toContain('UNTIL=20250403')
    expect(win(fol.ics, '2025-04-01T00:00:00Z', '2025-05-01T00:00:00Z')).toHaveLength(3)
  })
})
