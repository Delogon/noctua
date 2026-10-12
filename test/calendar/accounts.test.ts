import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import {
  addAccount,
  discover,
  removeAccount,
  suggestFromMailAccount,
  testAccount,
  updateAccountName,
  updateAccountPassword
} from '@main/calendar/accounts'
import { calSecretKey } from '@main/calendar/repo'
import { accountSecretKey } from '@main/auth/providers'
import { getSecret, hasSecret, setSecret } from '@main/auth/secrets'
import { DavAuthError } from '@main/dav'
import { closeTestDb, createTestDb, seedAccount } from '../helpers/db'
import { FakeCalDavServer } from '../helpers/fake-caldav'
import { invokeContract } from '@shared/ipc-contract'

let db: Database.Database
let server: FakeCalDavServer
const URL_HOME = 'https://cal.test/dav/calendars/anna/'

beforeEach(() => {
  db = createTestDb()
  server = new FakeCalDavServer()
  server.addCalendar('personal', 'Persönlich')
  server.addCalendar('work', 'Arbeit')
})
afterEach(() => closeTestDb(db))

describe('Kalender-Konten', () => {
  it('discover prüft ohne zu speichern', async () => {
    const found = await discover(
      db,
      { serverInput: URL_HOME, username: 'anna', password: 'pw' },
      { fetch: server.fetch }
    )
    expect(found.calendars.map((c) => c.displayName)).toEqual(['Persönlich', 'Arbeit'])
    expect(db.prepare('SELECT count(*) n FROM cal_accounts').get()).toEqual({ n: 0 })
  })

  it('add legt Konto + Kalender an und speichert das Passwort (ohne Leerzeichen) im Vault', async () => {
    const res = await addAccount(
      db,
      { name: 'Nextcloud', serverInput: URL_HOME, username: 'anna', password: 'ab cd ef gh' },
      { fetch: server.fetch }
    )
    expect(res).toMatchObject({ calendarCount: 2, autoSchedule: false })
    const acc = db.prepare('SELECT * FROM cal_accounts WHERE id = ?').get(res.accountId) as Record<
      string,
      unknown
    >
    expect(acc).toMatchObject({ name: 'Nextcloud', username: 'anna', home_url: URL_HOME })
    expect(getSecret(calSecretKey(res.accountId))).toBe('abcdefgh')
    expect(
      db.prepare('SELECT count(*) n FROM calendars WHERE account_id = ?').get(res.accountId)
    ).toEqual({ n: 2 })
    // Passwort steht nirgends in der DB-Zeile
    expect(JSON.stringify(acc)).not.toContain('abcdefgh')
  })

  it('falsche Zugangsdaten: DavAuthError, nichts gespeichert', async () => {
    server.forceStatus = 401
    await expect(
      addAccount(
        db,
        { name: 'x', serverInput: URL_HOME, username: 'anna', password: 'falsch' },
        { fetch: server.fetch }
      )
    ).rejects.toBeInstanceOf(DavAuthError)
    expect(db.prepare('SELECT count(*) n FROM cal_accounts').get()).toEqual({ n: 0 })
  })

  it('http:// wird abgelehnt', async () => {
    await expect(
      addAccount(
        db,
        { name: 'x', serverInput: 'http://cal.test/dav/', username: 'a', password: 'p' },
        { fetch: server.fetch }
      )
    ).rejects.toThrow(/https/)
    expect(server.calls).toHaveLength(0)
  })

  it('Vorbelegung aus Mail-Konto: Adresse als Benutzername, Passwort übernehmen', async () => {
    const mailId = seedAccount(db, { email: 'anna@example.org' })
    setSecret(accountSecretKey(mailId), 'mail-passwort')
    expect(suggestFromMailAccount(db, mailId)).toEqual({
      username: 'anna@example.org',
      serverInput: 'anna@example.org',
      canReusePassword: true
    })
    const res = await addAccount(
      db,
      {
        name: 'Kalender',
        serverInput: URL_HOME,
        username: 'anna@example.org',
        mailAccountId: mailId,
        reuseMailPassword: true
      },
      { fetch: server.fetch }
    )
    expect(getSecret(calSecretKey(res.accountId))).toBe('mail-passwort')
    expect(db.prepare('SELECT mail_account_id FROM cal_accounts').get()).toEqual({
      mail_account_id: mailId
    })
    // Eigenständiges Konto: Löschen des Kalender-Kontos lässt das Mail-Passwort unberührt
    removeAccount(db, res.accountId)
    expect(hasSecret(accountSecretKey(mailId))).toBe(true)
  })

  it('OAuth-Mailkonten können ihr Passwort nicht übernehmen', async () => {
    const mailId = seedAccount(db)
    db.prepare(`UPDATE accounts SET credential_type = 'oauth-ms' WHERE id = ?`).run(mailId)
    expect(suggestFromMailAccount(db, mailId).canReusePassword).toBe(false)
    await expect(
      discover(
        db,
        { serverInput: URL_HOME, username: 'a', mailAccountId: mailId, reuseMailPassword: true },
        { fetch: server.fetch }
      )
    ).rejects.toThrow(/App-Passwort/)
  })

  it('updatePassword prüft zuerst; falsches Passwort überschreibt nichts', async () => {
    const { accountId } = await addAccount(
      db,
      { name: 'N', serverInput: URL_HOME, username: 'anna', password: 'alt' },
      { fetch: server.fetch }
    )
    server.forceStatus = 401
    await expect(
      updateAccountPassword(db, accountId, 'neu', { fetch: server.fetch })
    ).rejects.toBeInstanceOf(DavAuthError)
    expect(getSecret(calSecretKey(accountId))).toBe('alt')
    server.forceStatus = null
    await updateAccountPassword(db, accountId, 'n e u', { fetch: server.fetch })
    expect(getSecret(calSecretKey(accountId))).toBe('neu')
  })

  it('test, rename, remove (Secret + Kalender weg)', async () => {
    const { accountId } = await addAccount(
      db,
      { name: 'N', serverInput: URL_HOME, username: 'anna', password: 'pw' },
      { fetch: server.fetch }
    )
    expect(await testAccount(db, accountId, { fetch: server.fetch })).toEqual({
      calendarCount: 2,
      autoSchedule: false
    })
    updateAccountName(db, accountId, '  Neuer Name ')
    expect(db.prepare('SELECT name FROM cal_accounts').get()).toEqual({ name: 'Neuer Name' })
    removeAccount(db, accountId)
    expect(hasSecret(calSecretKey(accountId))).toBe(false)
    expect(db.prepare('SELECT count(*) n FROM calendars').get()).toEqual({ n: 0 })
  })
})

describe('IPC-Vertrag (Kalender)', () => {
  it('begrenzt Eingaben (Maximal-Längen) und validiert Formen', () => {
    const add = invokeContract['calendar:accounts:add'].input
    expect(
      add.safeParse({ name: 'x', serverInput: 'a'.repeat(501), username: 'u', password: 'p' })
        .success
    ).toBe(false)
    expect(
      add.safeParse({
        name: 'x',
        serverInput: 'cloud.example.com',
        username: 'u',
        password: 'p'.repeat(1001)
      }).success
    ).toBe(false)
    expect(
      add.safeParse({ name: 'x', serverInput: 'cloud.example.com', username: 'u', password: 'p' })
        .success
    ).toBe(true)

    const create = invokeContract['calendar:events:create'].input
    const base = {
      calendarId: 1,
      summary: 's',
      location: null,
      description: null,
      time: {
        allDay: false,
        start: '2025-01-01T10:00:00',
        end: '2025-01-01T11:00:00',
        tzid: 'UTC'
      },
      rrule: null,
      status: null,
      transparency: null,
      alarms: [],
      attendees: [],
      organizer: null
    }
    expect(create.safeParse({ event: base }).success).toBe(true)
    expect(create.safeParse({ event: { ...base, summary: 'x'.repeat(1001) } }).success).toBe(false)
    expect(create.safeParse({ event: { ...base, description: 'x'.repeat(50_001) } }).success).toBe(
      false
    )
    expect(
      create.safeParse({
        event: {
          ...base,
          alarms: new Array(21).fill({
            action: 'DISPLAY',
            relativeTo: 'START',
            offsetSeconds: -60,
            absoluteUtc: null,
            description: null
          })
        }
      }).success
    ).toBe(false)
    expect(create.safeParse({ event: { ...base, rrule: 'x'.repeat(501) } }).success).toBe(false)

    const update = invokeContract['calendar:events:update'].input
    expect(
      update.safeParse({ objectId: 1, scope: 'weird', recurrenceId: null, patch: {} }).success
    ).toBe(false)
    expect(
      update.safeParse({
        objectId: 1,
        scope: 'following',
        recurrenceId: '2025-01-01T10:00:00Z',
        patch: { summary: 'n' }
      }).success
    ).toBe(true)

    const color = invokeContract['calendar:setColor'].input
    expect(color.safeParse({ calendarId: 1, color: 'red' }).success).toBe(false)
    expect(color.safeParse({ calendarId: 1, color: null }).success).toBe(true)
    expect(
      invokeContract['calendar:events:list'].input.safeParse({
        rangeStart: 0,
        rangeEnd: 1,
        tz: 'x'.repeat(101)
      }).success
    ).toBe(false)
  })
})
