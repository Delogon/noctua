import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { CalendarEventInput } from '@shared/calendar-types'
import { createEvent, setCalendarChangedHandler, updateEvent } from '@main/calendar/service'
import { schedulingInfo } from '@main/calendar/invitations'
import { selfBusy } from '@main/calendar/freebusy'
import { setItipMailer, type ItipMail } from '@main/calendar/mailer'
import { flushItipQueue } from '@main/calendar/organizer'
import { closeTestDb, createTestDb, seedAccount } from '../helpers/db'

let db: Database.Database
let calAccount: number
let calId: number
let sent: ItipMail[]

const attendee = (email: string): CalendarEventInput['attendees'][number] => ({
  email,
  name: null,
  role: 'REQ-PARTICIPANT',
  partstat: 'NEEDS-ACTION',
  rsvp: true,
  cutype: 'INDIVIDUAL'
})

const input = (over: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  calendarId: calId,
  summary: 'Planung',
  location: null,
  description: null,
  time: { allDay: false, start: '2099-03-23T09:00:00', end: '2099-03-23T10:00:00', tzid: 'UTC' },
  rrule: null,
  status: null,
  transparency: null,
  alarms: [],
  attendees: [],
  organizer: null,
  ...over
})

beforeEach(() => {
  db = createTestDb()
  const mail = seedAccount(db, { email: 'me@mail.example.com' })
  calAccount = Number(
    db
      .prepare(
        `INSERT INTO cal_accounts (name, server_url, home_url, username, mail_account_id, created_at)
         VALUES ('T', 'https://x.test/', 'https://x.test/cal/', 'me', ?, 1)`
      )
      .run(mail).lastInsertRowid
  )
  calId = Number(
    db
      .prepare(
        `INSERT INTO calendars (account_id, url, display_name, components)
         VALUES (?, 'https://x.test/cal/p/', 'Privat', 'VEVENT')`
      )
      .run(calAccount).lastInsertRowid
  )
  sent = []
  setItipMailer((_account, m) => sent.push(m))
  setCalendarChangedHandler(() => {})
})
afterEach(() => {
  setItipMailer(null)
  setCalendarChangedHandler(() => {})
  closeTestDb(db)
})

describe('Scheduling-Kontext des Editors', () => {
  it('neuer Termin: ich bin Organisator, eigene Adresse bekannt', () => {
    const info = schedulingInfo(db, { calendarId: calId })
    expect(info.organizerIsMe).toBe(true)
    expect(info.ownAddress).toBe('me@mail.example.com')
    expect(info.myAddresses).toContain('me@mail.example.com')
    expect(info.invitation).toBeNull()
    expect(info.autoSchedule).toBe(false)
  })

  it('Termin ohne Organisator oder mit mir als Organisator: ich; fremder Organisator: nicht', () => {
    const own = createEvent(input()).objectId
    expect(schedulingInfo(db, { calendarId: calId, objectId: own }).organizerIsMe).toBe(true)
    const withAtt = createEvent(input({ attendees: [attendee('bob@partner.example.net')] }))
    expect(
      schedulingInfo(db, { calendarId: calId, objectId: withAtt.objectId }).organizerIsMe
    ).toBe(true)
    const foreign = createEvent(
      input({
        attendees: [attendee('me@mail.example.com')],
        organizer: { email: 'chef@other.example.com', name: null }
      })
    )
    const info = schedulingInfo(db, { calendarId: calId, objectId: foreign.objectId })
    expect(info.organizerIsMe).toBe(false)
    expect(info.invitation).toBeNull() // keine Einladungsmail zu diesem Termin
  })
})

describe('Teilnehmer nachträglich hinzufügen', () => {
  it('Termin ohne Organisator: Nutzer wird Organisator, Einladung geht raus', () => {
    const { objectId } = createEvent(input())
    db.prepare('DELETE FROM cal_pending_ops').run()
    db.prepare('UPDATE cal_objects SET pending_op = NULL, etag = ?').run('"e"')
    updateEvent(objectId, 'all', null, { attendees: [attendee('bob@partner.example.net')] })
    const obj = db.prepare('SELECT ics FROM cal_objects WHERE id = ?').get(objectId) as {
      ics: string
    }
    expect(obj.ics).toMatch(/ORGANIZER.*me@mail\.example\.com/)
    db.prepare('DELETE FROM cal_pending_ops').run()
    flushItipQueue(db, calAccount)
    expect(sent.map((m) => m.method)).toEqual(['REQUEST'])
    expect(sent[0].to).toEqual(['bob@partner.example.net'])
  })
})

describe('selfBusy excludeObjectId', () => {
  it('der bearbeitete Termin zählt nicht als belegt', () => {
    const a = createEvent(input()).objectId
    createEvent(
      input({
        time: {
          allDay: false,
          start: '2099-03-23T12:00:00',
          end: '2099-03-23T13:00:00',
          tzid: 'UTC'
        }
      })
    )
    const range = { rangeStart: Date.UTC(2099, 2, 23), rangeEnd: Date.UTC(2099, 2, 24) }
    expect(selfBusy(range, db)).toHaveLength(2)
    expect(selfBusy({ ...range, excludeObjectId: a }, db)).toEqual([
      { startUtc: Date.UTC(2099, 2, 23, 12), endUtc: Date.UTC(2099, 2, 23, 13), type: 'BUSY' }
    ])
  })
})
