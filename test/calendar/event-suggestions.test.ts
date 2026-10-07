import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  acceptEventSuggestion,
  dismissEventSuggestion,
  eventInputFromSuggestion,
  listEventSuggestions,
  markEventSuggestionEditing,
  storeEventSuggestions,
  type ResolvedEvent
} from '@main/calendar/event-suggestions'
import { createEvent, getEvent, setCalendarChangedHandler } from '@main/calendar/service'
import { setSetting } from '@main/db'
import { storeBody, upsertEnvelope } from '@main/mail/ingest'
import { closeTestDb, createTestDb, makeEnvelope, seedAccount, seedFolder } from '../helpers/db'

let db: Database.Database
let mailAccount: number
let messageId: number
let calAccount: number
let calId: number

const timed: ResolvedEvent = {
  title: 'Projektgespräch',
  allDay: false,
  startLocal: '2099-03-23T14:00:00',
  endLocal: '2099-03-23T15:30:00',
  tzid: 'America/New_York',
  location: 'Büro',
  link: 'https://meet.example/x',
  kind: 'proposed',
  confidence: 0.9
}
const allDay: ResolvedEvent = {
  ...timed,
  title: 'Betriebsausflug',
  allDay: true,
  startLocal: '2099-03-25',
  endLocal: '2099-03-27',
  tzid: null,
  location: null,
  link: null
}

function addCalendar(accountId: number, name: string, readOnly = 0): number {
  return Number(
    db
      .prepare(
        `INSERT INTO calendars (account_id, url, display_name, components, read_only)
         VALUES (?, ?, ?, 'VEVENT', ?)`
      )
      .run(accountId, `https://x.test/cal/${name}/`, name, readOnly).lastInsertRowid
  )
}

beforeEach(() => {
  db = createTestDb()
  mailAccount = seedAccount(db, { email: 'me@test.de' })
  const folder = seedFolder(db, mailAccount, '\\Inbox')
  messageId = upsertEnvelope(
    db,
    mailAccount,
    folder,
    makeEnvelope({ subject: 'Treffen' })
  )!.messageId
  storeBody(db, messageId, {
    messageId: '<m@test>',
    inReplyTo: null,
    references: [],
    subject: 'Treffen',
    from: { name: 'A', address: 'alice@test.de' },
    to: [],
    cc: [],
    replyTo: [],
    date: 1,
    text: 'x',
    html: null,
    snippet: 'x',
    attachments: []
  })
  calAccount = Number(
    db
      .prepare(
        `INSERT INTO cal_accounts (name, server_url, home_url, username, created_at)
         VALUES ('T', 'https://x.test/', 'https://x.test/cal/', 'u', 1)`
      )
      .run().lastInsertRowid
  )
  setCalendarChangedHandler(() => {})
})
afterEach(() => {
  setCalendarChangedHandler(() => {})
  closeTestDb(db)
})

function suggest(events: ResolvedEvent[]): number[] {
  storeEventSuggestions(
    db,
    { messageId, accountId: mailAccount, threadKey: 'T', model: 'm' },
    events
  )
  return (
    db.prepare('SELECT id FROM event_suggestions ORDER BY id').all() as Array<{ id: number }>
  ).map((r) => r.id)
}

describe('eventInputFromSuggestion', () => {
  it('terminiert mit Zone (genannt oder lokal) und Link in der Beschreibung', () => {
    const row = {
      title: timed.title,
      all_day: 0,
      start_local: timed.startLocal,
      end_local: timed.endLocal,
      tzid: timed.tzid,
      location: timed.location,
      link: timed.link
    }
    const input = eventInputFromSuggestion(row, 7, 'Treffen', 'Europe/Berlin')
    expect(input).toMatchObject({
      calendarId: 7,
      summary: 'Projektgespräch',
      location: 'Büro',
      time: {
        allDay: false,
        start: '2099-03-23T14:00:00',
        end: '2099-03-23T15:30:00',
        tzid: 'America/New_York'
      },
      alarms: [],
      attendees: [],
      organizer: null
    })
    expect(input.description).toBe('https://meet.example/x\nAus Mail: Treffen')
    // ohne genannte Zone: Zone des Nutzers
    expect(
      eventInputFromSuggestion({ ...row, tzid: null }, 7, null, 'Europe/Berlin').time.tzid
    ).toBe('Europe/Berlin')
  })

  it('ganztägig: Datumsformat, Ende exklusiv, keine Zone', () => {
    const input = eventInputFromSuggestion(
      {
        title: allDay.title,
        all_day: 1,
        start_local: allDay.startLocal,
        end_local: allDay.endLocal,
        tzid: null,
        location: null,
        link: null
      },
      1,
      null
    )
    expect(input.time).toEqual({ allDay: true, start: '2099-03-25', end: '2099-03-27', tzid: null })
    expect(input.description).toBeNull()
  })
})

describe('acceptEventSuggestion', () => {
  it('ruft createEvent mit den richtigen Feldern auf und markiert den Vorschlag', () => {
    calId = addCalendar(calAccount, 'privat')
    const [id] = suggest([timed])
    // Spion um das echte createEvent (der Vorschlag verweist per FK auf das Objekt)
    const create = vi.fn((...args: Parameters<typeof createEvent>) => createEvent(...args))
    const { objectId } = acceptEventSuggestion(db, id, { createEvent: create })
    expect(objectId).toBeGreaterThan(0)
    expect(create).toHaveBeenCalledTimes(1)
    const input = (create.mock.calls[0] as unknown[])[0]
    expect(input).toMatchObject({
      calendarId: calId,
      summary: 'Projektgespräch',
      time: { allDay: false, start: '2099-03-23T14:00:00', tzid: 'America/New_York' }
    })
    expect(
      db.prepare('SELECT state, cal_object_id FROM event_suggestions WHERE id = ?').get(id)
    ).toEqual({ state: 'accepted', cal_object_id: objectId })
    // zweiter Klick legt nichts doppelt an
    expect(acceptEventSuggestion(db, id, { createEvent: create })).toEqual({ objectId })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('legt den Termin wirklich an (ganztägig) und nutzt calendar.defaultCalendarId', () => {
    addCalendar(calAccount, 'erster')
    const second = addCalendar(calAccount, 'zweiter')
    setSetting('calendar.defaultCalendarId', String(second))
    const [id] = suggest([allDay])
    const { objectId } = acceptEventSuggestion(db, id)
    const event = getEvent(objectId, null, db)
    expect(event?.calendarId).toBe(second)
    expect(event?.fields.summary).toBe('Betriebsausflug')
    expect(event?.fields.time).toMatchObject({
      allDay: true,
      start: '2099-03-25',
      end: '2099-03-27'
    })
  })

  it('ohne beschreibbaren Kalender: Fehler, Vorschlag bleibt offen', () => {
    addCalendar(calAccount, 'nur-lesen', 1)
    const [id] = suggest([timed])
    expect(() => acceptEventSuggestion(db, id)).toThrow(/Kalender/)
    expect(db.prepare('SELECT state FROM event_suggestions WHERE id = ?').get(id)).toEqual({
      state: 'new'
    })
  })
})

describe('Vorschläge anzeigen', () => {
  it('Bearbeiten übergibt, Verwerfen versteckt, vergangene offene verschwinden', () => {
    addCalendar(calAccount, 'privat')
    const past = { ...timed, startLocal: '2020-01-01T10:00:00', endLocal: '2020-01-01T11:00:00' }
    const [a, b, c] = suggest([timed, allDay, past])
    const now = Date.UTC(2099, 0, 1)
    expect(listEventSuggestions(db, messageId, now).map((s) => s.id)).toEqual([c, a, b].slice(1))
    markEventSuggestionEditing(db, a)
    expect(listEventSuggestions(db, messageId, now).find((s) => s.id === a)?.state).toBe('accepted')
    dismissEventSuggestion(db, b)
    expect(listEventSuggestions(db, messageId, now).map((s) => s.id)).toEqual([a])
    const [first] = listEventSuggestions(db, messageId, now)
    expect(first.calendarId).not.toBeNull()
  })
})
