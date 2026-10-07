import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { CalendarEventInput } from '@shared/calendar-types'
import {
  createEvent,
  deleteEvent,
  getEvent,
  listAccounts,
  listCalendars,
  listEvents,
  setCalendarColor,
  setCalendarVisible,
  setCalendarChangedHandler,
  updateEvent
} from '@main/calendar/service'
import { ensureInstanceWindow, getInstanceWindow, listPendingOps } from '@main/calendar/repo'
import { closeTestDb, createTestDb } from '../helpers/db'

let db: Database.Database
let accountId: number
let calId: number
let changed: Array<[number, number[]]>

beforeEach(() => {
  db = createTestDb()
  accountId = Number(
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
         VALUES (?, 'https://x.test/cal/p/', 'Privat', 'VEVENT,VTODO')`
      )
      .run(accountId).lastInsertRowid
  )
  changed = []
  setCalendarChangedHandler((a, ids) => changed.push([a, ids]))
})
afterEach(() => {
  setCalendarChangedHandler(() => {})
  closeTestDb(db)
})

const input = (over: Partial<CalendarEventInput> = {}): CalendarEventInput => ({
  calendarId: calId,
  summary: 'Termin',
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
  attendees: [],
  organizer: null,
  ...over
})

const day = (s: string): number => Date.parse(`${s}T00:00:00Z`)

describe('Kalender & Konten', () => {
  it('listCalendars / Sichtbarkeit / Farbe / Konto-Zusammenfassung', () => {
    expect(listCalendars()).toEqual([
      expect.objectContaining({
        id: calId,
        displayName: 'Privat',
        visible: true,
        readOnly: false,
        components: ['VEVENT', 'VTODO']
      })
    ])
    setCalendarVisible(calId, false)
    expect(listCalendars(accountId)[0].visible).toBe(false)
    setCalendarColor(calId, '#AABBCC')
    expect(listCalendars()[0].color).toBe('#aabbcc')
    expect(() => setCalendarColor(calId, 'rot')).toThrow()
    expect(changed.length).toBe(2)
    const acc = listAccounts()[0]
    expect(acc).toMatchObject({ id: accountId, calendarCount: 1, pendingOps: 0, deadOps: 0 })
  })
})

describe('listEvents', () => {
  it('Neuanlage ist sofort lokal sichtbar, wartet als pending Op', () => {
    const { objectId } = createEvent(input())
    expect(listPendingOps(db, accountId)).toHaveLength(1)
    const events = listEvents({ rangeStart: day('2099-03-01'), rangeEnd: day('2099-04-01') })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      objectId,
      summary: 'Termin',
      location: 'Büro',
      allDay: false,
      recurring: false,
      pending: true,
      readOnly: false
    })
    expect(new Date(events[0].startUtc).toISOString()).toBe('2099-03-23T08:00:00.000Z')
    expect(changed.at(-1)).toEqual([accountId, [calId]])
  })

  it('filtert nach Spanne, Sichtbarkeit und calendarIds', () => {
    createEvent(input())
    expect(listEvents({ rangeStart: day('2099-04-01'), rangeEnd: day('2099-05-01') })).toHaveLength(
      0
    )
    setCalendarVisible(calId, false)
    expect(listEvents({ rangeStart: day('2099-03-01'), rangeEnd: day('2099-04-01') })).toHaveLength(
      0
    )
    expect(
      listEvents({
        rangeStart: day('2099-03-01'),
        rangeEnd: day('2099-04-01'),
        calendarIds: [calId]
      })
    ).toHaveLength(1)
    expect(
      listEvents({ rangeStart: day('2099-03-01'), rangeEnd: day('2099-04-01'), calendarIds: [] })
    ).toHaveLength(0)
    expect(listEvents({ rangeStart: 5, rangeEnd: 5 })).toEqual([])
  })

  it('ganztägig: Zuordnung nach Kalendertagen der Betrachter-Zone, nicht UTC', () => {
    createEvent(
      input({ time: { allDay: true, start: '2099-03-23', end: '2099-03-24', tzid: null } })
    )
    // Berliner Tag 23.3. = 22.3. 23:00Z … 23.3. 23:00Z
    const berlin = (from: string, to: string): ReturnType<typeof listEvents> =>
      listEvents({
        rangeStart: Date.parse(from),
        rangeEnd: Date.parse(to),
        tz: 'Europe/Berlin'
      })
    expect(berlin('2099-03-22T23:00:00Z', '2099-03-23T23:00:00Z')).toHaveLength(1)
    expect(berlin('2099-03-23T23:00:00Z', '2099-03-24T23:00:00Z')).toHaveLength(0) // 24.3. lokal
    expect(berlin('2099-03-21T23:00:00Z', '2099-03-22T23:00:00Z')).toHaveLength(0) // 22.3. lokal
    const [e] = berlin('2099-03-22T23:00:00Z', '2099-03-23T23:00:00Z')
    expect([e.startDay, e.endDay, e.allDay]).toEqual(['2099-03-23', '2099-03-24', true])
    // Betrachter in Los Angeles sieht ihn am selben Kalendertag
    expect(
      listEvents({
        rangeStart: Date.parse('2099-03-23T07:00:00Z'),
        rangeEnd: Date.parse('2099-03-24T07:00:00Z'),
        tz: 'America/Los_Angeles'
      })
    ).toHaveLength(1)
  })

  it('wiederkehrend im Fenster (cal_instances) und außerhalb (Live-Expansion)', () => {
    const now = Date.now()
    const start = new Date(now + 5 * 86_400_000).toISOString().slice(0, 10)
    const { objectId } = createEvent(
      input({
        time: {
          allDay: false,
          start: `${start}T09:00:00`,
          end: `${start}T10:00:00`,
          tzid: 'Europe/Berlin'
        },
        rrule: 'FREQ=WEEKLY'
      })
    )
    const inWin = listEvents({ rangeStart: now, rangeEnd: now + 30 * 86_400_000 })
    expect(inWin.length).toBeGreaterThanOrEqual(4)
    expect(inWin.every((e) => e.recurring && e.objectId === objectId)).toBe(true)
    const w = getInstanceWindow(db)
    expect(w.to).toBeGreaterThan(now + 500 * 86_400_000)
    // Spanne weit hinter dem Fenster: wird live expandiert
    const far = now + 800 * 86_400_000
    const live = listEvents({ rangeStart: far, rangeEnd: far + 14 * 86_400_000 })
    expect(live.length).toBeGreaterThanOrEqual(2)
    expect(live[0].recurrenceId).toMatch(/Z$/)
    expect(
      db.prepare('SELECT count(*) n FROM cal_instances WHERE start_utc >= ?').get(far)
    ).toEqual({ n: 0 })
  })

  it('ensureInstanceWindow rückt das Fenster nach (monatlich) und materialisiert neu', () => {
    const now = Date.now()
    const start = new Date(now).toISOString().slice(0, 10)
    createEvent(
      input({
        time: { allDay: false, start: `${start}T09:00:00`, end: `${start}T10:00:00`, tzid: 'UTC' },
        rrule: 'FREQ=DAILY'
      })
    )
    const before = db.prepare('SELECT max(start_utc) m FROM cal_instances').get() as { m: number }
    expect(ensureInstanceWindow(db, now + 5 * 86_400_000)).toBe(false)
    expect(ensureInstanceWindow(db, now + 40 * 86_400_000)).toBe(true)
    const after = db.prepare('SELECT max(start_utc) m FROM cal_instances').get() as { m: number }
    expect(after.m).toBeGreaterThan(before.m + 30 * 86_400_000)
  })
})

describe('getEvent', () => {
  it('liefert Felder in Wandzeit + TZID, Alarme und Regel', () => {
    const { objectId } = createEvent(
      input({
        rrule: 'FREQ=WEEKLY;COUNT=3',
        alarms: [
          {
            action: 'DISPLAY',
            relativeTo: 'START',
            offsetSeconds: -900,
            absoluteUtc: null,
            description: null
          }
        ]
      })
    )
    const d = getEvent(objectId, null)
    expect(d).toMatchObject({
      objectId,
      calendarId: calId,
      recurring: true,
      readOnly: false,
      pending: true
    })
    expect(d.fields.time).toEqual({
      allDay: false,
      start: '2099-03-23T09:00:00',
      end: '2099-03-23T10:00:00',
      tzid: 'Europe/Berlin'
    })
    expect(d.fields.rrule).toBe('FREQ=WEEKLY;COUNT=3')
    expect(d.fields.alarms[0].offsetSeconds).toBe(-900)
    const second = getEvent(objectId, '2099-03-30T07:00:00Z') // nach der Umstellung (CEST)
    expect(second.recurrenceId).toBe('2099-03-30T07:00:00Z')
    expect(second.fields.time.start).toBe('2099-03-30T09:00:00')
  })

  it('wirft bei unbekanntem Objekt/Vorkommen', () => {
    const { objectId } = createEvent(input({ rrule: 'FREQ=DAILY;COUNT=2' }))
    expect(() => getEvent(9999)).toThrow()
    expect(() => getEvent(objectId, '2099-03-23T12:34:56Z')).toThrow(/Serie/)
  })
})

describe('updateEvent / deleteEvent', () => {
  const series = (): number => createEvent(input({ rrule: 'FREQ=DAILY;COUNT=5' })).objectId // 23.–27.3.2099
  const range = { rangeStart: day('2099-03-01'), rangeEnd: day('2099-05-01') }

  it('"alle" ändert die Serie, SEQUENCE steigt, Op wird zusammengeführt', () => {
    const id = series()
    updateEvent(id, 'all', null, { summary: 'Neu' })
    updateEvent(id, 'all', null, { location: null })
    expect(listPendingOps(db, accountId)).toHaveLength(1) // create bleibt create
    const events = listEvents(range)
    expect(events).toHaveLength(5)
    expect(new Set(events.map((e) => e.summary))).toEqual(new Set(['Neu']))
    expect(events[0].location).toBeNull()
    expect(getEvent(id).sequence).toBe(2)
  })

  it('"dieses": Override für ein Vorkommen', () => {
    const id = series()
    const second = listEvents(range)[1]
    updateEvent(id, 'this', second.recurrenceId, {
      summary: 'Nur heute',
      time: {
        allDay: false,
        start: '2099-03-24T14:00:00',
        end: '2099-03-24T15:00:00',
        tzid: 'Europe/Berlin'
      }
    })
    const events = listEvents(range)
    expect(events).toHaveLength(5)
    const ov = events.find((e) => e.isOverride)!
    expect(ov.summary).toBe('Nur heute')
    expect(new Date(ov.startUtc).toISOString()).toBe('2099-03-24T13:00:00.000Z')
    expect(events.filter((e) => e.summary === 'Termin')).toHaveLength(4)
    expect(getEvent(id, ov.recurrenceId).isOverride).toBe(true)
  })

  it('"dieses und folgende": zwei Objekte, beide mit Op', () => {
    const id = series()
    const third = listEvents(range)[2]
    const res = updateEvent(id, 'following', third.recurrenceId, { summary: 'Fortsetzung' })
    expect(res.createdObjectId).not.toBeNull()
    expect(res.createdObjectId).not.toBe(id)
    const events = listEvents(range)
    expect(events).toHaveLength(5)
    expect(events.filter((e) => e.summary === 'Termin')).toHaveLength(2)
    expect(
      events.filter((e) => e.summary === 'Fortsetzung' && e.objectId === res.createdObjectId)
    ).toHaveLength(3)
    expect(listPendingOps(db, accountId)).toHaveLength(2)
  })

  it('Löschen: "dieses" (EXDATE), "folgende" (UNTIL), "alle" (Objekt weg)', () => {
    const id = series()
    const evs = listEvents(range)
    deleteEvent(id, 'this', evs[1].recurrenceId)
    expect(listEvents(range)).toHaveLength(4)
    deleteEvent(id, 'following', evs[3].recurrenceId)
    expect(listEvents(range)).toHaveLength(2)
    deleteEvent(id, 'all', null)
    expect(listEvents(range)).toHaveLength(0)
    // nie übertragene Neuanlage verschwindet ersatzlos
    expect(listPendingOps(db, accountId)).toHaveLength(0)
    expect(() => getEvent(id)).toThrow()
  })

  it('Löschen eines synchronisierten Objekts: unsichtbar, Op "delete" mit Basis-ETag', () => {
    const { objectId } = createEvent(input())
    db.prepare(`DELETE FROM cal_pending_ops`).run()
    db.prepare(`UPDATE cal_objects SET pending_op = NULL, etag = '"e1"' WHERE id = ?`).run(objectId)
    deleteEvent(objectId, 'all', null)
    expect(listEvents(range)).toHaveLength(0)
    const ops = listPendingOps(db, accountId)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'delete', base_etag: '"e1"' })
    expect(() => updateEvent(objectId, 'all', null, { summary: 'x' })).toThrow(/nicht gefunden/)
  })

  it('schreibgeschützte Kalender lehnen Änderungen ab', () => {
    const { objectId } = createEvent(input())
    db.prepare('UPDATE calendars SET read_only = 1').run()
    expect(() => updateEvent(objectId, 'all', null, { summary: 'x' })).toThrow(/schreibgeschützt/)
    expect(() => deleteEvent(objectId, 'all', null)).toThrow(/schreibgeschützt/)
    expect(() => createEvent(input())).toThrow(/schreibgeschützt/)
    expect(getEvent(objectId).readOnly).toBe(true)
  })
})
