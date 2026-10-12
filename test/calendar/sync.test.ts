import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { DavClient, DavAuthError, DavTransportError } from '@main/dav'
import {
  AccountLoop,
  backoffDelay,
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  POLL_INTERVAL_MS,
  pushPendingOps,
  syncAccount,
  type ConflictInfo,
  type SyncContext
} from '@main/calendar/sync'
import {
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  getCalAccount,
  getCalendar,
  getObjectByHref,
  listDeadOps,
  listPendingOps,
  MAX_CAL_OP_ATTEMPTS,
  type CalAccountRow
} from '@main/calendar/repo'
import { createEventIcs, updateIcs } from '@main/calendar/edit'
import { closeTestDb, createTestDb } from '../helpers/db'
import { FakeCalDavServer } from '../helpers/fake-caldav'
import { ics } from '../dav/fixtures'

const HOME_URL = 'https://cal.test/dav/calendars/anna/'

let db: Database.Database
let server: FakeCalDavServer
let conflicts: ConflictInfo[]
let changes: Array<[number, number[]]>

beforeEach(() => {
  db = createTestDb()
  server = new FakeCalDavServer()
  server.addCalendar('personal', 'Persönlich')
  conflicts = []
  changes = []
})
afterEach(() => closeTestDb(db))

function seedAccount(): CalAccountRow {
  const r = db
    .prepare(
      `INSERT INTO cal_accounts (name, server_url, home_url, username, created_at)
       VALUES ('Test', 'https://cal.test/dav/', ?, 'anna', 1)`
    )
    .run(HOME_URL)
  return getCalAccount(db, Number(r.lastInsertRowid))!
}

function ctxFor(s = server): SyncContext {
  return {
    db,
    client: new DavClient({ username: 'anna', password: 'pw', fetch: s.fetch }),
    events: {
      onChanged: (a, ids) => changes.push([a, ids]),
      onConflict: (c) => conflicts.push(c)
    }
  }
}

const ev = (uid: string, summary = uid): string =>
  ics({
    uid,
    summary,
    dtstart: 'DTSTART:20990101T100000Z',
    dtend: 'DTEND:20990101T110000Z'
  })

const localObjects = (): Array<{ href: string; etag: string | null; summary: string | null }> =>
  db.prepare('SELECT href, etag, summary FROM cal_objects ORDER BY href').all() as never

const cal = (): ReturnType<typeof getCalendar> =>
  getCalendar(db, (db.prepare('SELECT id FROM calendars').get() as { id: number }).id)

describe('Sync: Lesen', () => {
  it('Erstabgleich per sync-collection: Kalender, Objekte, Instanzen, ctag, Token', async () => {
    server.put('personal', 'a.ics', ev('a'))
    server.put('personal', 'b.ics', ev('b'))
    const account = seedAccount()
    await syncAccount(ctxFor(), account)

    const calendar = cal()!
    expect(calendar.display_name).toBe('Persönlich')
    expect(calendar.ctag).toMatch(/^ctag-/)
    expect(calendar.sync_token).toMatch(/^tok-/)
    expect(localObjects().map((o) => o.summary)).toEqual(['a', 'b'])
    expect(db.prepare('SELECT count(*) n FROM cal_instances').get()).toEqual({ n: 2 })
    expect(server.callsOfKind('sync-collection')).toHaveLength(1)
    expect(server.callsOfKind('multiget')).toHaveLength(1)
    expect(changes.length).toBeGreaterThan(0)
  })

  it('unveränderter ctag: kein Report mehr', async () => {
    server.put('personal', 'a.ics', ev('a'))
    const account = seedAccount()
    await syncAccount(ctxFor(), account)
    server.calls.length = 0
    await syncAccount(ctxFor(), account)
    expect(server.callsOfKind('sync-collection')).toHaveLength(0)
    expect(server.callsOfKind('multiget')).toHaveLength(0)
    expect(server.callsOfKind('list')).toHaveLength(1)
  })

  it('inkrementell: ändert, löscht und ergänzt gezielt (nur Geändertes wird geladen)', async () => {
    server.put('personal', 'a.ics', ev('a'))
    server.put('personal', 'b.ics', ev('b'))
    server.put('personal', 'c.ics', ev('c'))
    const account = seedAccount()
    await syncAccount(ctxFor(), account)
    server.calls.length = 0

    server.put('personal', 'a.ics', ev('a', 'a geändert'))
    server.remove('personal', 'b.ics')
    server.put('personal', 'd.ics', ev('d'))
    await syncAccount(ctxFor(), account)

    expect(localObjects().map((o) => o.summary)).toEqual(['a geändert', 'c', 'd'])
    const multiget = server.callsOfKind('multiget')
    expect(multiget).toHaveLength(1)
    expect(multiget[0].body).toContain('a.ics')
    expect(multiget[0].body).toContain('d.ics')
    expect(multiget[0].body).not.toContain('c.ics')
    expect(db.prepare('SELECT count(*) n FROM cal_instances').get()).toEqual({ n: 3 })
  })

  it('Token ungültig → vollständiger Neuabgleich, verwaiste Objekte verschwinden', async () => {
    server.put('personal', 'a.ics', ev('a'))
    server.put('personal', 'b.ics', ev('b'))
    const account = seedAccount()
    await syncAccount(ctxFor(), account)

    server.remove('personal', 'b.ics')
    server.invalidateTokens('personal')
    server.calls.length = 0
    await syncAccount(ctxFor(), account)

    expect(localObjects().map((o) => o.summary)).toEqual(['a'])
    // erst mit altem Token versucht (403), dann mit leerem Token
    const reports = server.callsOfKind('sync-collection')
    expect(reports).toHaveLength(2)
    expect(reports[0].body).toContain('tok-')
    expect(reports[1].body).toContain('<d:sync-token/>')
    expect(cal()!.sync_token).toMatch(/^tok-/)
  })

  it('507 (gekürzt): folgt dem neuen Token bis alles geladen ist', async () => {
    const paged = new FakeCalDavServer({ pageSize: 2 })
    paged.addCalendar('personal')
    for (const n of ['a', 'b', 'c', 'd', 'e']) paged.put('personal', `${n}.ics`, ev(n))
    const account = seedAccount()
    await syncAccount(ctxFor(paged), account)
    expect(localObjects()).toHaveLength(5)
    expect(paged.callsOfKind('sync-collection').length).toBeGreaterThanOrEqual(3)
  })

  it('ohne sync-collection: ctag + ETag-Vergleich + multiget', async () => {
    const plain = new FakeCalDavServer({ supportsSync: false })
    plain.addCalendar('personal')
    plain.put('personal', 'a.ics', ev('a'))
    plain.put('personal', 'b.ics', ev('b'))
    const account = seedAccount()
    await syncAccount(ctxFor(plain), account)
    expect(plain.callsOfKind('sync-collection')).toHaveLength(0)
    expect(plain.callsOfKind('calendar-query')).toHaveLength(1)
    expect(localObjects()).toHaveLength(2)

    plain.calls.length = 0
    plain.put('personal', 'a.ics', ev('a', 'neu'))
    plain.remove('personal', 'b.ics')
    await syncAccount(ctxFor(plain), account)
    expect(localObjects().map((o) => o.summary)).toEqual(['neu'])
    expect(plain.callsOfKind('multiget')).toHaveLength(1)
    expect(plain.callsOfKind('multiget')[0].body).not.toContain('b.ics')
    expect(cal()!.sync_token).toBeNull()
  })

  it('Server lehnt sync-collection ab (501): dauerhaft auf ETag-Abgleich', async () => {
    const odd = new FakeCalDavServer()
    odd.addCalendar('personal')
    odd.put('personal', 'a.ics', ev('a'))
    const original = odd.fetch
    odd.fetch = async (input, init) =>
      init?.body && String(init.body).includes('sync-collection')
        ? new Response('', { status: 501 })
        : original(input, init)
    const account = seedAccount()
    await syncAccount(ctxFor(odd), account)
    expect(localObjects()).toHaveLength(1)
    expect(cal()!.supports_sync).toBe(0)
  })

  it('gelöschter Kalender verschwindet samt Objekten; leere Liste löscht nichts', async () => {
    server.addCalendar('work', 'Arbeit')
    server.put('work', 'w.ics', ev('w'))
    server.put('personal', 'a.ics', ev('a'))
    const account = seedAccount()
    await syncAccount(ctxFor(), account)
    expect(db.prepare('SELECT count(*) n FROM calendars').get()).toEqual({ n: 2 })

    server.removeCalendar('work')
    await syncAccount(ctxFor(), account)
    expect(db.prepare('SELECT count(*) n FROM calendars').get()).toEqual({ n: 1 })
    expect(localObjects().map((o) => o.summary)).toEqual(['a'])

    server.removeCalendar('personal')
    await syncAccount(ctxFor(), account)
    expect(db.prepare('SELECT count(*) n FROM calendars').get()).toEqual({ n: 1 })
  })

  it('Nutzerfarbe wird vom Server-Sync nicht überschrieben', async () => {
    const account = seedAccount()
    await syncAccount(ctxFor(), account)
    db.prepare(`UPDATE calendars SET color = '#112233', color_user_set = 1`).run()
    await syncAccount(ctxFor(), account)
    expect(cal()!.color).toBe('#112233')
  })

  it('nicht lesbares ICS bricht den Sync nicht ab (INVALID gespeichert)', async () => {
    server.put('personal', 'bad.ics', 'das ist kein ics')
    server.put('personal', 'ok.ics', ev('ok'))
    await syncAccount(ctxFor(), seedAccount())
    const rows = db.prepare('SELECT href, component FROM cal_objects ORDER BY href').all()
    expect(rows).toEqual([
      { href: '/dav/calendars/anna/personal/bad.ics', component: 'INVALID' },
      { href: '/dav/calendars/anna/personal/ok.ics', component: 'VEVENT' }
    ])
  })

  it('wiederkehrende Serie wird im Fenster materialisiert', async () => {
    const now = Date.now()
    const start = new Date(now + 86_400_000).toISOString().slice(0, 10).replace(/-/g, '')
    server.put(
      'personal',
      'r.ics',
      ics({
        uid: 'r',
        summary: 'Serie',
        dtstart: `DTSTART:${start}T080000Z`,
        dtend: `DTEND:${start}T090000Z`,
        extra: 'RRULE:FREQ=DAILY'
      })
    )
    await syncAccount(ctxFor(), seedAccount())
    const n = (db.prepare('SELECT count(*) n FROM cal_instances').get() as { n: number }).n
    // ~18 Monate Fenster
    expect(n).toBeGreaterThan(500)
    expect(n).toBeLessThan(600)
  })
})

describe('Sync: lokale Änderungen (offline-first)', () => {
  async function prepared(): Promise<{ account: CalAccountRow; calendarId: number }> {
    server.put('personal', 'a.ics', ev('a'))
    const account = seedAccount()
    await syncAccount(ctxFor(), account)
    return { account, calendarId: cal()!.id }
  }

  it('Neuanlage: sofort lokal sichtbar, dann per PUT mit If-None-Match: * übertragen', async () => {
    const { account } = await prepared()
    const { ics: text, uid } = createEventIcs({
      summary: 'Neu',
      location: null,
      description: null,
      time: {
        allDay: false,
        start: '2099-02-01T10:00:00',
        end: '2099-02-01T11:00:00',
        tzid: 'UTC'
      },
      rrule: null,
      status: null,
      transparency: null,
      alarms: [],
      attendees: [],
      organizer: null
    })
    enqueueCreate(db, cal()!, uid, text)
    // optimistisch lokal vorhanden, noch nicht auf dem Server
    const local = getObjectByHref(db, cal()!.id, `/dav/calendars/anna/personal/${uid}.ics`)!
    expect(local.pending_op).toBe('create')
    expect(local.etag).toBeNull()
    expect(
      db.prepare('SELECT count(*) n FROM cal_instances WHERE object_id = ?').get(local.id)
    ).toEqual({ n: 1 })
    expect(server.calendars.get('personal')!.objects.size).toBe(1)

    await syncAccount(ctxFor(), account)
    const put = server.callsOfKind('put')[0]
    expect(put.headers['if-none-match']).toBe('*')
    expect(put.headers['content-type']).toContain('text/calendar')
    const after = getObjectByHref(db, cal()!.id, local.href)!
    expect(after.pending_op).toBeNull()
    expect(after.etag).toBe(server.object('personal', `${uid}.ics`)!.etag)
    expect(listPendingOps(db, account.id)).toHaveLength(0)
  })

  it('Änderung: If-Match mit Basis-ETag; mehrere Änderungen werden zusammengeführt', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    const baseEtag = obj.etag
    const v1 = updateIcs(obj.ics, {
      scope: 'all',
      recurrenceId: null,
      patch: { summary: 'v1' }
    }).ics
    enqueueUpdate(db, obj, cal()!, v1)
    const obj2 = getObjectByHref(db, cal()!.id, obj.href)!
    const v2 = updateIcs(v1, { scope: 'all', recurrenceId: null, patch: { summary: 'v2' } }).ics
    enqueueUpdate(db, obj2, cal()!, v2)
    expect(listPendingOps(db, account.id)).toHaveLength(1)

    await syncAccount(ctxFor(), account)
    const puts = server.callsOfKind('put')
    expect(puts).toHaveLength(1)
    expect(puts[0].headers['if-match']).toBe(baseEtag)
    expect(server.object('personal', 'a.ics')!.ics).toContain('SUMMARY:v2')
    expect(getObjectByHref(db, cal()!.id, obj.href)!.summary).toBe('v2')
  })

  it('Löschen: DELETE mit If-Match; Neuanlage + Löschen offline verschwindet ersatzlos', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueDelete(db, obj, cal()!)
    expect(db.prepare('SELECT count(*) n FROM cal_instances').get()).toEqual({ n: 0 })
    await syncAccount(ctxFor(), account)
    expect(server.callsOfKind('delete')[0].headers['if-match']).toBe(obj.etag)
    expect(server.calendars.get('personal')!.objects.size).toBe(0)
    expect(localObjects()).toHaveLength(0)

    const c = createEventIcs({
      summary: 'x',
      location: null,
      description: null,
      time: { allDay: true, start: '2099-01-01', end: '2099-01-02', tzid: null },
      rrule: null,
      status: null,
      transparency: null,
      alarms: [],
      attendees: [],
      organizer: null
    })
    enqueueCreate(db, cal()!, c.uid, c.ics)
    const created = getObjectByHref(db, cal()!.id, `/dav/calendars/anna/personal/${c.uid}.ics`)!
    enqueueDelete(db, created, cal()!)
    expect(listPendingOps(db, account.id)).toHaveLength(0)
    expect(localObjects()).toHaveLength(0)
  })

  it('412 bei Änderung: Server-Fassung bleibt, lokale Fassung als dead-Op, Konflikt gemeldet', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    const mine = updateIcs(obj.ics, {
      scope: 'all',
      recurrenceId: null,
      patch: { summary: 'meine Änderung' }
    }).ics
    enqueueUpdate(db, obj, cal()!, mine)
    // anderer Client ändert zwischenzeitlich
    server.put('personal', 'a.ics', ev('a', 'Änderung vom Server'))

    await pushPendingOps(ctxFor(), account)
    expect(server.object('personal', 'a.ics')!.ics).toContain('Änderung vom Server')
    const local = getObjectByHref(db, cal()!.id, obj.href)!
    expect(local.summary).toBe('Änderung vom Server')
    expect(local.pending_op).toBeNull()
    expect(local.etag).toBe(server.object('personal', 'a.ics')!.etag)
    const dead = listDeadOps(db, account.id)
    expect(dead).toHaveLength(1)
    expect(dead[0].last_error).toContain('conflict')
    expect(dead[0].ics).toContain('SUMMARY:meine Änderung')
    expect(conflicts).toEqual([
      expect.objectContaining({ kind: 'update', reason: 'conflict', uid: 'a' })
    ])
    expect(listPendingOps(db, account.id)).toHaveLength(0)
  })

  it('412 weil Server das Objekt gelöscht hat: lokal entfernt, Konflikt "deleted-on-server"', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueUpdate(
      db,
      obj,
      cal()!,
      updateIcs(obj.ics, { scope: 'all', recurrenceId: null, patch: { summary: 'x' } }).ics
    )
    server.remove('personal', 'a.ics')
    await pushPendingOps(ctxFor(), account)
    expect(localObjects()).toHaveLength(0)
    expect(conflicts[0].reason).toBe('deleted-on-server')
  })

  it('412 beim Löschen: Löschung verworfen, Server-Fassung bleibt', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueDelete(db, obj, cal()!)
    server.put('personal', 'a.ics', ev('a', 'inzwischen geändert'))
    await pushPendingOps(ctxFor(), account)
    expect(server.object('personal', 'a.ics')).toBeDefined()
    expect(getObjectByHref(db, cal()!.id, obj.href)!.summary).toBe('inzwischen geändert')
    expect(conflicts[0]).toMatchObject({ kind: 'delete', reason: 'conflict' })
  })

  it('Sync überschreibt keine lokal wartende Änderung', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueUpdate(
      db,
      obj,
      cal()!,
      updateIcs(obj.ics, { scope: 'all', recurrenceId: null, patch: { summary: 'lokal' } }).ics
    )
    server.put('personal', 'a.ics', ev('a', 'server'))
    // Netz weg: Push scheitert, Lesen darf lokal nichts überschreiben
    const offline = new FakeCalDavServer()
    offline.throwNetwork = true
    await expect(syncAccount(ctxFor(offline), account)).rejects.toBeInstanceOf(DavTransportError)
    expect(getObjectByHref(db, cal()!.id, obj.href)!.summary).toBe('lokal')
    expect(listPendingOps(db, account.id)[0].attempts).toBe(0) // Netzfehler zählt nicht
  })

  it('PUT ohne ETag im Response: Server-Fassung wird nachgeladen', async () => {
    const quirky = new FakeCalDavServer({ noEtagOnPut: true })
    quirky.addCalendar('personal')
    const account = seedAccount()
    await syncAccount(ctxFor(quirky), account)
    const c = createEventIcs({
      summary: 'q',
      location: null,
      description: null,
      time: { allDay: true, start: '2099-01-01', end: '2099-01-02', tzid: null },
      rrule: null,
      status: null,
      transparency: null,
      alarms: [],
      attendees: [],
      organizer: null
    })
    enqueueCreate(db, cal()!, c.uid, c.ics)
    await pushPendingOps(ctxFor(quirky), account)
    expect(quirky.callsOfKind('get')).toHaveLength(1)
    const obj = getObjectByHref(db, cal()!.id, `/dav/calendars/anna/personal/${c.uid}.ics`)!
    expect(obj.etag).toBe(quirky.object('personal', `${c.uid}.ics`)!.etag)
  })

  it('Dauerhafter Fehler (403): Op sofort dead, lokale Änderung zurückgerollt', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueUpdate(
      db,
      obj,
      cal()!,
      updateIcs(obj.ics, { scope: 'all', recurrenceId: null, patch: { summary: 'x' } }).ics
    )
    server.failWrites = 403
    await pushPendingOps(ctxFor(), account)
    expect(listDeadOps(db, account.id)).toHaveLength(1)
    expect(conflicts[0].reason).toBe('forbidden')
    // etag zurückgesetzt → nächster Sync lädt die Server-Fassung
    expect(getObjectByHref(db, cal()!.id, obj.href)!.etag).toBeNull()
    server.failWrites = null
    await syncAccount(ctxFor(), account)
    expect(getObjectByHref(db, cal()!.id, obj.href)!.summary).toBe('a')
  })

  it('Dead-Letter nach MAX Versuchen bei 5xx', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueUpdate(
      db,
      obj,
      cal()!,
      updateIcs(obj.ics, { scope: 'all', recurrenceId: null, patch: { summary: 'x' } }).ics
    )
    server.failWrites = 503
    for (let i = 0; i < MAX_CAL_OP_ATTEMPTS - 1; i++) {
      await pushPendingOps(ctxFor(), account)
      expect(listPendingOps(db, account.id)).toHaveLength(1)
      expect(listPendingOps(db, account.id)[0].attempts).toBe(i + 1)
    }
    await pushPendingOps(ctxFor(), account)
    expect(listPendingOps(db, account.id)).toHaveLength(0)
    const dead = listDeadOps(db, account.id)
    expect(dead).toHaveLength(1)
    expect(dead[0].last_error).toContain('attempts')
    expect(conflicts.at(-1)!.reason).toBe('attempts')
  })

  it('Auth-Fehler beim Push bricht ab und zählt keinen Versuch', async () => {
    const { account } = await prepared()
    const obj = getObjectByHref(db, cal()!.id, '/dav/calendars/anna/personal/a.ics')!
    enqueueUpdate(
      db,
      obj,
      cal()!,
      updateIcs(obj.ics, { scope: 'all', recurrenceId: null, patch: { summary: 'x' } }).ics
    )
    server.forceStatus = 401
    await expect(pushPendingOps(ctxFor(), account)).rejects.toBeInstanceOf(DavAuthError)
    expect(listPendingOps(db, account.id)[0].attempts).toBe(0)
  })
})

describe('AccountLoop', () => {
  it('401 → needs-reauth (kein Backoff), Passwort fehlt → needs-reauth, Erfolg → idle + last_sync', async () => {
    const account = seedAccount()
    const states: string[] = []
    const mk = (password: string | null, s = server): AccountLoop =>
      new AccountLoop(account.id, {
        db,
        fetch: s.fetch,
        getPassword: () => password,
        events: { onChanged: () => {}, onConflict: () => {} },
        onState: (_id, state) => states.push(state)
      })

    expect(await mk(null).runOnce()).toBe('needs-reauth')
    expect(getCalAccount(db, account.id)!.state).toBe('needs-reauth')

    server.forceStatus = 401
    expect(await mk('falsch').runOnce()).toBe('needs-reauth')
    expect(getCalAccount(db, account.id)!.last_error).toContain('401')

    server.forceStatus = 500
    expect(await mk('pw').runOnce()).toBe('error')
    expect(getCalAccount(db, account.id)!.state).toBe('error')

    server.forceStatus = null
    expect(await mk('pw').runOnce()).toBe('ok')
    const row = getCalAccount(db, account.id)!
    expect(row.state).toBe('idle')
    expect(row.last_sync).toBeGreaterThan(0)
    expect(row.last_error).toBeNull()
    expect(states).toContain('syncing')
  })

  it('Backoff wächst exponentiell mit Jitter bis zum Maximum; Poll ~5 min', () => {
    expect(backoffDelay(0, () => 0.5)).toBe(BACKOFF_BASE_MS)
    expect(backoffDelay(1, () => 0.5)).toBe(BACKOFF_BASE_MS * 2)
    expect(backoffDelay(0, () => 0)).toBeCloseTo(BACKOFF_BASE_MS * 0.7)
    expect(backoffDelay(0, () => 1)).toBeCloseTo(BACKOFF_BASE_MS * 1.3)
    expect(backoffDelay(30, () => 0.5)).toBe(BACKOFF_MAX_MS)
    expect(POLL_INTERVAL_MS).toBe(300_000)
  })
})
