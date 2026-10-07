import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { CATCH_UP_MS, ReminderScheduler, type ReminderNotice } from '@main/calendar/reminders'
import { upsertObject } from '@main/calendar/repo'
import { resolveZone } from '@main/calendar/tz'
import { closeTestDb, createTestDb } from '../helpers/db'

let db: Database.Database
let calId: number
let notices: ReminderNotice[]

beforeEach(() => {
  db = createTestDb()
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
        `INSERT INTO calendars (account_id, url, display_name) VALUES (?, 'https://x.test/cal/p/', 'P')`
      )
      .run(acc).lastInsertRowid
  )
  notices = []
})
afterEach(() => closeTestDb(db))

const scheduler = (): ReminderScheduler => {
  const s = new ReminderScheduler()
  s.init(db, (n) => notices.push(n))
  return s
}

const T0 = Date.parse('2099-06-10T10:00:00Z') // Terminbeginn
const MIN = 60_000

function addEvent(
  uid: string,
  opts: { start?: string; end?: string; extra?: string; alarm?: string; summary?: string } = {}
): number {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//T//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20990101T000000Z',
    opts.start ?? 'DTSTART:20990610T100000Z',
    opts.end ?? 'DTEND:20990610T110000Z',
    `SUMMARY:${opts.summary ?? 'Besprechung'}`,
    'LOCATION:Raum 5',
    opts.extra ?? '',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    opts.alarm ?? 'TRIGGER:-PT15M',
    'DESCRIPTION:Erinnerung',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    ''
  ]
    .filter((l, i, a) => l !== '' || i === a.length - 1)
    .join('\r\n')
  return upsertObject(db, { calendarId: calId, href: `/cal/p/${uid}.ics`, etag: '"1"', ics })
}

describe('Erinnerungen', () => {
  it('feuert zur Auslösezeit genau einmal', () => {
    const id = addEvent('a')
    const s = scheduler()
    expect(s.tick(T0 - 16 * MIN)).toBe(0)
    expect(s.tick(T0 - 14 * MIN)).toBe(1)
    expect(s.tick(T0 - 13 * MIN)).toBe(0)
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({ objectId: id, recurrenceId: null, title: 'Besprechung' })
    expect(notices[0].body).toContain('Raum 5')
  })

  it('kein Duplikat nach Neustart (Zustand liegt in der DB)', () => {
    addEvent('a')
    expect(scheduler().tick(T0 - 14 * MIN)).toBe(1)
    const restarted = scheduler()
    expect(restarted.tick(T0 - 14 * MIN + 5000)).toBe(0)
    expect(restarted.tick(T0 - 5 * MIN)).toBe(0)
    expect(notices).toHaveLength(1)
  })

  it('holt Verpasstes nach (bis 15 min), danach nicht mehr', () => {
    addEvent('late')
    const s = scheduler()
    // Alarm fällig um T0-15min; App startet 10 min später
    expect(s.tick(T0 - 5 * MIN)).toBe(1)
    addEvent('later', { start: 'DTSTART:20990610T120000Z', end: 'DTEND:20990610T130000Z' })
    const fireAt = Date.parse('2099-06-10T12:00:00Z') - 15 * MIN
    expect(s.tick(fireAt + CATCH_UP_MS + MIN)).toBe(0)
  })

  it('ausgeblendete Kalender, abgesagte und gelöschte Termine lösen nichts aus', () => {
    const hidden = addEvent('h')
    addEvent('c', { extra: 'STATUS:CANCELLED' })
    const del = addEvent('d')
    db.prepare(`UPDATE cal_objects SET pending_op = 'delete' WHERE id = ?`).run(del)
    db.prepare('UPDATE calendars SET visible = 0').run()
    expect(scheduler().tick(T0 - 10 * MIN)).toBe(0)
    db.prepare('UPDATE calendars SET visible = 1').run()
    const s = scheduler()
    expect(s.tick(T0 - 10 * MIN)).toBe(1) // nur „h"
    expect(notices[0].objectId).toBe(hidden)
  })

  it('wiederkehrende Termine: jedes Vorkommen feuert einmal', () => {
    addEvent('r', { extra: 'RRULE:FREQ=DAILY;COUNT=3' })
    const s = scheduler()
    const day = 24 * 60 * MIN
    expect(s.tick(T0 - 14 * MIN)).toBe(1)
    expect(s.tick(T0 - 14 * MIN + 1000)).toBe(0)
    expect(s.tick(T0 + day - 14 * MIN)).toBe(1)
    expect(s.tick(T0 + 2 * day - 14 * MIN)).toBe(1)
    expect(s.tick(T0 + 3 * day - 14 * MIN)).toBe(0)
    expect(new Set(notices.map((n) => n.recurrenceId)).size).toBe(3)
  })

  it('Alarm relativ zum Ende, absoluter Alarm, EMAIL wird ignoriert', () => {
    addEvent('end', { alarm: 'TRIGGER;RELATED=END:-PT5M' })
    const s = scheduler()
    expect(s.tick(Date.parse('2099-06-10T10:56:00Z'))).toBe(1) // Ende 11:00 − 5 min
    addEvent('abs', { alarm: 'TRIGGER;VALUE=DATE-TIME:20990610T083000Z' })
    expect(s.tick(Date.parse('2099-06-10T08:31:00Z'))).toBe(1)
    const mail = addEvent('mail')
    db.prepare(
      `UPDATE cal_objects SET ics = replace(ics, 'ACTION:DISPLAY', 'ACTION:EMAIL') WHERE id = ?`
    ).run(mail)
    expect(scheduler().tick(T0 - 14 * MIN)).toBe(0)
  })

  it('ganztägig: relativ zu lokaler Mitternacht', () => {
    addEvent('ad', {
      start: 'DTSTART;VALUE=DATE:20990610',
      end: 'DTEND;VALUE=DATE:20990611',
      alarm: 'TRIGGER:PT9H'
    })
    const nine = resolveZone(null).wallToUtc({ y: 2099, m: 6, d: 10, h: 9, mi: 0, s: 0 })
    const s = scheduler()
    expect(s.tick(nine - MIN)).toBe(0)
    expect(s.tick(nine + MIN)).toBe(1)
    expect(notices[0].allDay).toBe(true)
  })

  it('Snooze zeigt die Erinnerung später erneut; Abschalten per Setting', () => {
    addEvent('s')
    const s = scheduler()
    s.tick(T0 - 14 * MIN)
    s.snooze(notices[0], 10, T0 - 14 * MIN)
    expect(s.tick(T0 - 5 * MIN)).toBe(0)
    expect(s.tick(T0 - 4 * MIN + 1000)).toBe(1)
    expect(notices).toHaveLength(2)

    addEvent('off', { start: 'DTSTART:20990612T100000Z', end: 'DTEND:20990612T110000Z' })
    db.prepare(`INSERT INTO settings (key, value) VALUES ('calendar.reminders', '0')`).run()
    expect(scheduler().tick(Date.parse('2099-06-12T09:50:00Z'))).toBe(0)
  })
})
