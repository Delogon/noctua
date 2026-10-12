import { describe, expect, it } from 'vitest'
import {
  expandResource,
  extractObjectFields,
  parseCalendar,
  readFields,
  vtimezonesOf
} from '@main/calendar/ics'

const CRLF = (s: string): string => s.trim().split('\n').join('\r\n') + '\r\n'
const iso = (ms: number): string => new Date(ms).toISOString().replace('.000Z', 'Z')

const wrap = (body: string): string =>
  CRLF(`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
${body}
END:VCALENDAR`)

const BERLIN_TZ = `BEGIN:VTIMEZONE
TZID:Europe/Berlin
BEGIN:DAYLIGHT
TZOFFSETFROM:+0100
TZOFFSETTO:+0200
TZNAME:CEST
DTSTART:19700329T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0200
TZOFFSETTO:+0100
TZNAME:CET
DTSTART:19701025T030000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE`

const range = (from: string, to: string): { windowStart: number; windowEnd: number } => ({
  windowStart: Date.parse(from),
  windowEnd: Date.parse(to)
})

describe('Objektfelder', () => {
  it('liest Einzeltermin mit TZID und Felder', () => {
    const root = parseCalendar(
      wrap(`${BERLIN_TZ}
BEGIN:VEVENT
UID:one@test
DTSTAMP:20250101T000000Z
DTSTART;TZID=Europe/Berlin:20250715T090000
DTEND;TZID=Europe/Berlin:20250715T100000
SUMMARY:Standup\\, täglich
LOCATION:Raum 1
ORGANIZER;CN=Anna:mailto:Anna@Example.com
STATUS:CONFIRMED
SEQUENCE:3
END:VEVENT`)
    )
    const f = extractObjectFields(root)
    expect(f).toMatchObject({
      uid: 'one@test',
      component: 'VEVENT',
      summary: 'Standup, täglich',
      location: 'Raum 1',
      tzid: 'Europe/Berlin',
      allDay: false,
      hasRrule: false,
      status: 'CONFIRMED',
      organizer: 'anna@example.com',
      sequence: 3
    })
    expect(iso(f.dtstartUtc!)).toBe('2025-07-15T07:00:00Z')
    expect(iso(f.dtendUtc!)).toBe('2025-07-15T08:00:00Z')
  })

  it('VTODO wird gespeichert, ungültiges ICS wirft', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VTODO
UID:t@test
DTSTAMP:20250101T000000Z
SUMMARY:Aufgabe
DUE;VALUE=DATE:20250801
END:VTODO`)
    )
    expect(extractObjectFields(root).component).toBe('VTODO')
    expect(() => parseCalendar('kein ics')).toThrow()
  })

  it('Roundtrip: parse → toString → parse erhält Felder inkl. X-Properties', () => {
    const text = wrap(`BEGIN:VEVENT
UID:rt@test
DTSTAMP:20250101T000000Z
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
SUMMARY:RT
X-CUSTOM;X-P=1:wert
BEGIN:VALARM
ACTION:DISPLAY
TRIGGER:-PT15M
DESCRIPTION:Erinnerung
END:VALARM
END:VEVENT`)
    const again = parseCalendar(parseCalendar(text).toString())
    expect(again.toString()).toContain('X-CUSTOM;X-P=1:wert')
    const fields = readFields(again.getFirstSubcomponent('vevent')!, vtimezonesOf(again))
    expect(fields.alarms).toEqual([
      {
        action: 'DISPLAY',
        relativeTo: 'START',
        offsetSeconds: -900,
        absoluteUtc: null,
        description: 'Erinnerung'
      }
    ])
    expect(fields.time).toEqual({
      allDay: false,
      start: '2025-01-01T10:00:00',
      end: '2025-01-01T11:00:00',
      tzid: 'UTC'
    })
  })

  it('liest Teilnehmer und Organisator', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:att@test
DTSTAMP:20250101T000000Z
DTSTART:20250101T100000Z
ORGANIZER;CN=Anna:mailto:anna@example.com
ATTENDEE;CN=Bob;ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=TRUE:mailto:bob@example.com
END:VEVENT`)
    )
    const f = readFields(root.getFirstSubcomponent('vevent')!, vtimezonesOf(root))
    expect(f.organizer).toEqual({ email: 'anna@example.com', name: 'Anna' })
    expect(f.attendees[0]).toMatchObject({
      email: 'bob@example.com',
      name: 'Bob',
      role: 'OPT-PARTICIPANT',
      partstat: 'ACCEPTED',
      rsvp: true
    })
  })
})

describe('Expansion', () => {
  it('wöchentlich über die Sommerzeit-Umstellung (Europe/Berlin): lokale Uhrzeit bleibt', () => {
    const root = parseCalendar(
      wrap(`${BERLIN_TZ}
BEGIN:VEVENT
UID:w@test
DTSTAMP:20250101T000000Z
DTSTART;TZID=Europe/Berlin:20250321T090000
DTEND;TZID=Europe/Berlin:20250321T100000
RRULE:FREQ=WEEKLY;COUNT=4
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-03-01T00:00:00Z', '2025-05-01T00:00:00Z'))
    expect(occ.map((o) => iso(o.startUtc))).toEqual([
      '2025-03-21T08:00:00Z',
      '2025-03-28T08:00:00Z',
      '2025-04-04T07:00:00Z', // nach der Umstellung (30.3.)
      '2025-04-11T07:00:00Z'
    ])
    expect(occ[2].endUtc - occ[2].startUtc).toBe(3600_000)
    expect(occ[0].recurrenceId).toBe('2025-03-21T08:00:00Z')
  })

  it('täglicher Termin um 02:30 an der Umstellung (Lücke)', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:gap@test
DTSTAMP:20250101T000000Z
DTSTART;TZID=Europe/Berlin:20250329T023000
DTEND;TZID=Europe/Berlin:20250329T033000
RRULE:FREQ=DAILY;COUNT=3
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-03-01T00:00:00Z', '2025-05-01T00:00:00Z'))
    expect(occ.map((o) => iso(o.startUtc))).toEqual([
      '2025-03-29T01:30:00Z',
      '2025-03-30T01:30:00Z', // 02:30 existiert nicht → 03:30 CEST
      '2025-03-31T00:30:00Z'
    ])
  })

  it('EXDATE, UNTIL und INTERVAL', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:ex@test
DTSTAMP:20250101T000000Z
DTSTART;TZID=Europe/Berlin:20250106T100000
DTEND;TZID=Europe/Berlin:20250106T110000
RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;UNTIL=20250203T090000Z
EXDATE;TZID=Europe/Berlin:20250120T100000
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-01-01T00:00:00Z', '2025-12-31T00:00:00Z'))
    expect(occ.map((o) => iso(o.startUtc))).toEqual([
      '2025-01-06T09:00:00Z',
      '2025-02-03T09:00:00Z'
    ])
  })

  it('RECURRENCE-ID-Ausnahme ersetzt das Vorkommen (verschoben, anderer Titel)', () => {
    const root = parseCalendar(
      wrap(`${BERLIN_TZ}
BEGIN:VEVENT
UID:ov@test
DTSTAMP:20250101T000000Z
DTSTART;TZID=Europe/Berlin:20250707T100000
DTEND;TZID=Europe/Berlin:20250707T110000
RRULE:FREQ=DAILY;COUNT=3
SUMMARY:Serie
END:VEVENT
BEGIN:VEVENT
UID:ov@test
DTSTAMP:20250101T000000Z
RECURRENCE-ID;TZID=Europe/Berlin:20250708T100000
DTSTART;TZID=Europe/Berlin:20250708T140000
DTEND;TZID=Europe/Berlin:20250708T153000
SUMMARY:Sonderfall
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-07-01T00:00:00Z', '2025-08-01T00:00:00Z'))
    expect(occ).toHaveLength(3)
    const moved = occ.find((o) => o.isOverride)!
    expect(iso(moved.startUtc)).toBe('2025-07-08T12:00:00Z')
    expect(iso(moved.endUtc)).toBe('2025-07-08T13:30:00Z')
    expect(moved.recurrenceId).toBe('2025-07-08T08:00:00Z')
    expect(moved.comp.getFirstPropertyValue('summary')).toBe('Sonderfall')
    expect(occ.filter((o) => !o.isOverride).map((o) => o.recurrenceId)).toEqual([
      '2025-07-07T08:00:00Z',
      '2025-07-09T08:00:00Z'
    ])
  })

  it('Ganztägig: Datumswerte, mehrtägig, kein Zeitzonen-Drift', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:ad@test
DTSTAMP:20250101T000000Z
DTSTART;VALUE=DATE:20250310
DTEND;VALUE=DATE:20250312
RRULE:FREQ=MONTHLY;COUNT=3
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-01-01T00:00:00Z', '2025-12-31T00:00:00Z'))
    expect(occ.map((o) => [o.startDay, o.endDay])).toEqual([
      ['2025-03-10', '2025-03-12'],
      ['2025-04-10', '2025-04-12'],
      ['2025-05-10', '2025-05-12']
    ])
    expect(occ[0].allDay).toBe(true)
    expect(occ[0].recurrenceId).toBe('2025-03-10')
  })

  it('Ganztägig ohne DTEND dauert einen Tag', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:ad1@test
DTSTAMP:20250101T000000Z
DTSTART;VALUE=DATE:20250310
END:VEVENT`)
    )
    const [o] = expandResource(root, range('2025-03-01T00:00:00Z', '2025-04-01T00:00:00Z'))
    expect([o.startDay, o.endDay]).toEqual(['2025-03-10', '2025-03-11'])
  })

  it('Floating (ohne TZID) wird in der Systemzone interpretiert und ist konsistent', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:fl@test
DTSTAMP:20250101T000000Z
DTSTART:20250310T090000
DTEND:20250310T100000
END:VEVENT`)
    )
    const [o] = expandResource(root, range('2025-03-01T00:00:00Z', '2025-04-01T00:00:00Z'))
    expect(o.endUtc - o.startUtc).toBe(3600_000)
  })

  it('DURATION statt DTEND und Fensterbegrenzung (unendliche Serie)', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:du@test
DTSTAMP:20250101T000000Z
DTSTART:20200101T080000Z
DURATION:PT90M
RRULE:FREQ=DAILY
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-06-01T00:00:00Z', '2025-06-04T00:00:00Z'))
    expect(occ).toHaveLength(3)
    expect(occ[0].endUtc - occ[0].startUtc).toBe(90 * 60_000)
  })

  it('Nur Ausnahme ohne Stamm (Einladung zu einem Vorkommen)', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:solo@test
DTSTAMP:20250101T000000Z
RECURRENCE-ID:20250505T080000Z
DTSTART:20250505T090000Z
DTEND:20250505T100000Z
END:VEVENT`)
    )
    const occ = expandResource(root, range('2025-05-01T00:00:00Z', '2025-06-01T00:00:00Z'))
    expect(occ).toHaveLength(1)
    expect(occ[0].isOverride).toBe(true)
  })

  it('Nicht wiederkehrender Termin außerhalb des Fensters liefert nichts', () => {
    const root = parseCalendar(
      wrap(`BEGIN:VEVENT
UID:out@test
DTSTAMP:20250101T000000Z
DTSTART:20250101T100000Z
DTEND:20250101T110000Z
END:VEVENT`)
    )
    expect(expandResource(root, range('2025-02-01T00:00:00Z', '2025-03-01T00:00:00Z'))).toEqual([])
  })
})
