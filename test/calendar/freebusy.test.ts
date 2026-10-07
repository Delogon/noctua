import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { parseScheduleResponse, queryFreeBusy, selfBusy } from '@main/calendar/freebusy'
import { createEvent, setCalendarChangedHandler } from '@main/calendar/service'
import { closeTestDb, createTestDb, seedAccount } from '../helpers/db'
import { createMockFetch } from '../helpers/dav-mock'

let db: Database.Database
let calAccount: number
let calId: number

beforeEach(() => {
  db = createTestDb()
  const mail = seedAccount(db, { email: 'me@mail.example.com' })
  calAccount = Number(
    db
      .prepare(
        `INSERT INTO cal_accounts (name, server_url, home_url, username, mail_account_id, schedule_outbox_url, auto_schedule, created_at)
         VALUES ('T', 'https://x.test/', 'https://x.test/cal/', 'me', ?, 'https://x.test/cal/outbox/', 1, 1)`
      )
      .run(mail).lastInsertRowid
  )
  calId = Number(
    db
      .prepare(
        `INSERT INTO calendars (account_id, url, display_name, components) VALUES (?, 'https://x.test/cal/p/', 'P', 'VEVENT')`
      )
      .run(calAccount).lastInsertRowid
  )
  setCalendarChangedHandler(() => {})
})
afterEach(() => {
  setCalendarChangedHandler(() => {})
  closeTestDb(db)
})

const make = (summary: string, start: string, end: string, extra: object = {}): void => {
  createEvent({
    calendarId: calId,
    summary,
    location: null,
    description: null,
    time: { allDay: false, start, end, tzid: 'UTC' },
    rrule: null,
    status: null,
    transparency: null,
    alarms: [],
    attendees: [],
    organizer: null,
    ...extra
  })
}

const T = (h: number, m = 0): number => Date.UTC(2099, 2, 23, h, m)

describe('selfBusy', () => {
  it('belegte Zeiten; TRANSPARENT/abgesagt ausgenommen, TENTATIVE getrennt, verschmolzen', () => {
    make('A', '2099-03-23T09:00:00', '2099-03-23T10:00:00')
    make('A2', '2099-03-23T10:00:00', '2099-03-23T10:30:00')
    make('Frei', '2099-03-23T12:00:00', '2099-03-23T13:00:00', { transparency: 'TRANSPARENT' })
    make('Abgesagt', '2099-03-23T14:00:00', '2099-03-23T15:00:00', { status: 'CANCELLED' })
    make('Vorläufig', '2099-03-23T16:00:00', '2099-03-23T17:00:00', { status: 'TENTATIVE' })
    expect(selfBusy({ rangeStart: T(0), rangeEnd: T(23) }, db)).toEqual([
      { startUtc: T(9), endUtc: T(10, 30), type: 'BUSY' },
      { startUtc: T(16), endUtc: T(17), type: 'BUSY-TENTATIVE' }
    ])
  })

  it('beschneidet auf die Anfrage; von mir abgelehnte Termine zählen nicht', () => {
    make('Lang', '2099-03-23T08:00:00', '2099-03-23T12:00:00')
    make('Abgelehnt', '2099-03-23T13:00:00', '2099-03-23T14:00:00', {
      attendees: [
        {
          email: 'me@mail.example.com',
          name: null,
          role: 'REQ-PARTICIPANT',
          partstat: 'DECLINED',
          rsvp: false,
          cutype: 'INDIVIDUAL'
        }
      ],
      organizer: { email: 'x@y.example.com', name: null }
    })
    expect(selfBusy({ rangeStart: T(10), rangeEnd: T(20) }, db)).toEqual([
      { startUtc: T(10), endUtc: T(12), type: 'BUSY' }
    ])
  })
})

const scheduleResponse = `<?xml version="1.0"?>
<C:schedule-response xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
 <C:response><C:recipient><D:href>mailto:bob@partner.example.net</D:href></C:recipient>
  <C:request-status>2.0;Success</C:request-status>
  <C:calendar-data>BEGIN:VCALENDAR
VERSION:2.0
METHOD:REPLY
BEGIN:VFREEBUSY
DTSTAMP:20990101T000000Z
DTSTART:20990323T000000Z
DTEND:20990324T000000Z
ATTENDEE:mailto:bob@partner.example.net
FREEBUSY;FBTYPE=BUSY:20990323T090000Z/20990323T100000Z
END:VFREEBUSY
END:VCALENDAR
</C:calendar-data></C:response>
 <C:response><C:recipient><D:href>mailto:ghost@partner.example.net</D:href></C:recipient>
  <C:request-status>3.7;Invalid Calendar User</C:request-status></C:response>
</C:schedule-response>`

describe('Scheduling-Outbox', () => {
  it('parseScheduleResponse', () => {
    const r = parseScheduleResponse(scheduleResponse)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ email: 'bob@partner.example.net', ok: true })
    expect(r[0].busy).toEqual([{ startUtc: T(9), endUtc: T(10), type: 'BUSY' }])
    expect(r[1]).toMatchObject({ email: 'ghost@partner.example.net', ok: false, busy: [] })
    expect(parseScheduleResponse('<kaputt')).toEqual([])
  })

  it('POST an den Outbox mit Originator/Recipient; "ich" kommt lokal', async () => {
    make('Meins', '2099-03-23T11:00:00', '2099-03-23T12:00:00')
    const { fetch, calls } = createMockFetch(() => ({
      status: 200,
      headers: { 'Content-Type': 'application/xml' },
      body: scheduleResponse
    }))
    const res = await queryFreeBusy(
      {
        accountId: calAccount,
        attendees: [
          'me@mail.example.com',
          'bob@partner.example.net',
          'ghost@partner.example.net',
          'kein-mail'
        ],
        rangeStart: T(0),
        rangeEnd: T(23)
      },
      db,
      { fetch, getPassword: () => 'pw', now: () => 1, newUid: () => 'fb' }
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://x.test/cal/outbox/')
    expect(calls[0].headers.originator).toBe('mailto:me@mail.example.com')
    expect(calls[0].headers.recipient).toBe(
      'mailto:bob@partner.example.net, mailto:ghost@partner.example.net'
    )
    expect(calls[0].body).toContain('BEGIN:VFREEBUSY')
    expect(res.map((r) => [r.email, r.source])).toEqual([
      ['me@mail.example.com', 'local'],
      ['bob@partner.example.net', 'server'],
      ['ghost@partner.example.net', 'unavailable']
    ])
    expect(res[0].busy).toEqual([{ startUtc: T(11), endUtc: T(12), type: 'BUSY' }])
    expect(res[1].busy).toHaveLength(1)
    expect(res[2].error).toContain('3.7')
  })

  it('ohne Scheduling-Outbox: nur "ich", andere unavailable (kein Request)', async () => {
    db.prepare('UPDATE cal_accounts SET schedule_outbox_url = NULL').run()
    const { fetch, calls } = createMockFetch(() => ({ status: 500 }))
    const res = await queryFreeBusy(
      {
        accountId: calAccount,
        attendees: ['me@mail.example.com', 'bob@partner.example.net'],
        rangeStart: T(0),
        rangeEnd: T(23)
      },
      db,
      { fetch, getPassword: () => 'pw' }
    )
    expect(calls).toHaveLength(0)
    expect(res.map((r) => r.source)).toEqual(['local', 'unavailable'])
  })

  it('Serverfehler: unavailable mit Fehlertext, kein Wurf', async () => {
    const { fetch } = createMockFetch(() => ({ status: 500 }))
    const res = await queryFreeBusy(
      {
        accountId: calAccount,
        attendees: ['bob@partner.example.net'],
        rangeStart: T(0),
        rangeEnd: T(23)
      },
      db,
      { fetch, getPassword: () => 'pw' }
    )
    expect(res[0].source).toBe('unavailable')
    expect(res[0].error).toBeTruthy()
  })

  it('zu großer Zeitraum wird abgelehnt', async () => {
    await expect(
      queryFreeBusy(
        { accountId: calAccount, attendees: ['a@b.de'], rangeStart: 0, rangeEnd: 90 * 86_400_000 },
        db
      )
    ).rejects.toThrow()
  })
})
