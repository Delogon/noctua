import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import ICAL from 'ical.js'
import type { CalendarEventInput } from '@shared/calendar-types'
import {
  createEvent,
  deleteEvent,
  setCalendarChangedHandler,
  updateEvent
} from '@main/calendar/service'
import { flushItipQueue } from '@main/calendar/organizer'
import { setItipMailer, type ItipMail } from '@main/calendar/mailer'
import { closeTestDb, createTestDb, seedAccount } from '../helpers/db'

let db: Database.Database
let calAccount: number
let calId: number
let sent: Array<{ account: number; mail: ItipMail }>

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
  location: 'Büro',
  description: null,
  time: {
    allDay: false,
    start: '2099-03-23T09:00:00',
    end: '2099-03-23T10:00:00',
    tzid: 'Europe/Berlin'
  },
  rrule: null,
  status: null,
  transparency: null,
  alarms: [],
  attendees: [attendee('bob@partner.example.net'), attendee('carla@partner.example.net')],
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
  setItipMailer((account, m) => sent.push({ account, mail: m }))
  setCalendarChangedHandler(() => {})
})
afterEach(() => {
  setItipMailer(null)
  setCalendarChangedHandler(() => {})
  closeTestDb(db)
})

/** Simuliert den erfolgreichen PUT: Ops weg, Objekte übertragen. */
const clearOps = (): void => {
  db.prepare('DELETE FROM cal_pending_ops').run()
  db.prepare('UPDATE cal_objects SET pending_op = NULL, etag = ?').run('"e"')
}
const ev = (ics: string): ICAL.Component =>
  new ICAL.Component(ICAL.parse(ics)).getFirstSubcomponent('vevent')!

describe('Organisator-Einladungen ohne Server-Scheduling', () => {
  it('Organisator wird der Nutzer; REQUEST geht erst nach erfolgreichem PUT raus', () => {
    createEvent(input())
    const obj = db.prepare('SELECT ics FROM cal_objects').get() as { ics: string }
    expect(obj.ics).toMatch(/ORGANIZER.*me@mail\.example\.com/)
    expect(flushItipQueue(db, calAccount)).toBe(0) // PUT steht noch aus
    expect(sent).toHaveLength(0)
    clearOps()
    expect(flushItipQueue(db, calAccount)).toBe(1)
    const { mail, account } = sent[0]
    expect(account).toBeGreaterThan(0)
    expect(mail.method).toBe('REQUEST')
    expect(mail.to.sort()).toEqual(['bob@partner.example.net', 'carla@partner.example.net'])
    expect(mail.ics).toContain('METHOD:REQUEST')
    expect(mail.subject).toContain('Planung')
    expect(flushItipQueue(db, calAccount)).toBe(0) // nicht doppelt
  })

  it('endgültig gescheiterter PUT: keine Einladung', () => {
    createEvent(input())
    db.prepare(`UPDATE cal_pending_ops SET status = 'dead'`).run()
    expect(flushItipQueue(db, calAccount)).toBe(0)
    expect(sent).toHaveLength(0)
    expect(db.prepare('SELECT count(*) c FROM cal_itip_queue').get()).toEqual({ c: 0 })
  })

  it('Server-Scheduling: nur PUT, keine eigene Mail (kein Doppelversand)', () => {
    db.prepare('UPDATE cal_accounts SET auto_schedule = 1').run()
    createEvent(input())
    clearOps()
    expect(flushItipQueue(db, calAccount)).toBe(0)
    expect(sent).toHaveLength(0)
  })

  it('notifyAttendees=false unterdrückt die Mail', () => {
    createEvent(input(), db, undefined, { notifyAttendees: false })
    clearOps()
    flushItipQueue(db, calAccount)
    expect(sent).toHaveLength(0)
  })

  it('ohne Teilnehmer oder mit fremdem Organisator: keine Mail', () => {
    createEvent(input({ attendees: [] }))
    createEvent(input({ organizer: { email: 'chef@other.example.com', name: null } }))
    clearOps()
    flushItipQueue(db, calAccount)
    expect(sent).toHaveLength(0)
  })

  it('wesentliche Änderung: REQUEST mit höherer SEQUENCE und PARTSTAT-Reset', () => {
    const { objectId } = createEvent(input())
    clearOps()
    flushItipQueue(db, calAccount)
    sent.length = 0
    db.prepare(
      `UPDATE cal_objects SET ics = replace(ics, 'PARTSTAT=NEEDS-ACTION', 'PARTSTAT=ACCEPTED')`
    ).run()
    updateEvent(objectId, 'all', null, {
      time: {
        allDay: false,
        start: '2099-03-23T11:00:00',
        end: '2099-03-23T12:00:00',
        tzid: 'Europe/Berlin'
      }
    })
    clearOps()
    flushItipQueue(db, calAccount)
    expect(sent).toHaveLength(1)
    const e = ev(sent[0].mail.ics)
    expect(e.getFirstPropertyValue('sequence')).toBe(1)
    for (const p of e.getAllProperties('attendee'))
      expect(p.getParameter('partstat')).toBe('NEEDS-ACTION')
  })

  it('unwesentliche Änderung (Beschreibung): keine Mail, SEQUENCE bleibt', () => {
    const { objectId } = createEvent(input())
    clearOps()
    flushItipQueue(db, calAccount)
    sent.length = 0
    updateEvent(objectId, 'all', null, { description: 'neu' })
    clearOps()
    flushItipQueue(db, calAccount)
    expect(sent).toHaveLength(0)
    const obj = db.prepare('SELECT sequence FROM cal_objects').get() as { sequence: number }
    expect(obj.sequence).toBe(0)
  })

  it('entfernter Teilnehmer bekommt CANCEL, neuer Teilnehmer REQUEST', () => {
    const { objectId } = createEvent(input())
    clearOps()
    flushItipQueue(db, calAccount)
    sent.length = 0
    updateEvent(objectId, 'all', null, {
      attendees: [attendee('carla@partner.example.net'), attendee('dora@partner.example.net')]
    })
    clearOps()
    flushItipQueue(db, calAccount)
    const req = sent.find((s) => s.mail.method === 'REQUEST')!
    const cancel = sent.find((s) => s.mail.method === 'CANCEL')!
    expect(req.mail.to).toEqual(['dora@partner.example.net'])
    expect(cancel.mail.to).toEqual(['bob@partner.example.net'])
    expect(ev(cancel.mail.ics).getAllProperties('attendee')).toHaveLength(1)
  })

  it('Löschen: CANCEL an alle; nie übertragener Termin: nichts', () => {
    const a = createEvent(input())
    clearOps()
    flushItipQueue(db, calAccount)
    sent.length = 0
    deleteEvent(a.objectId, 'all', null)
    expect(flushItipQueue(db, calAccount)).toBe(0) // DELETE noch ausstehend
    db.prepare('DELETE FROM cal_pending_ops').run()
    flushItipQueue(db, calAccount)
    expect(sent).toHaveLength(1)
    expect(sent[0].mail.method).toBe('CANCEL')
    expect(sent[0].mail.to).toHaveLength(2)
    expect(ev(sent[0].mail.ics).getFirstPropertyValue('status')).toBe('CANCELLED')

    sent.length = 0
    const b = createEvent(input({ summary: 'Nie gesendet' }))
    deleteEvent(b.objectId, 'all', null)
    db.prepare('DELETE FROM cal_pending_ops').run()
    flushItipQueue(db, calAccount)
    expect(sent).toHaveLength(0)
  })

  it('Mailer noch nicht bereit: Zeile bleibt für den nächsten Durchlauf', () => {
    createEvent(input())
    clearOps()
    setItipMailer(null)
    expect(flushItipQueue(db, calAccount)).toBe(0)
    expect(db.prepare('SELECT count(*) c FROM cal_itip_queue').get()).toEqual({ c: 1 })
    setItipMailer((account, m) => sent.push({ account, mail: m }))
    expect(flushItipQueue(db, calAccount)).toBe(1)
  })
})
