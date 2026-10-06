import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { DavAuthError, DavClient, InsecureUrlError, discoverCardDav } from '@main/dav'
import type { DnsResolver } from '@main/dav'
import { getCalAccount, calSecretKey, type CalAccountRow } from '@main/calendar/repo'
import { setSecret } from '@main/auth/secrets'
import { syncAccountContacts, type ContactsSyncContext } from '@main/contacts/sync'
import { contactsStatus, setAddressBookEnabled, setContactsSync } from '@main/contacts/accounts'
import { searchDavContacts } from '@main/contacts/repo'
import { suggestContacts } from '@main/db/repos/contacts'
import { closeTestDb, createTestDb, seedAccount as seedMailAccount } from '../helpers/db'
import { createMockFetch } from '../helpers/dav-mock'
import { FakeCardDavServer, PRINCIPAL } from '../helpers/fake-carddav'

const noDns: DnsResolver = {
  resolveSrv: async () => {
    throw new Error('ENODATA')
  },
  resolveTxt: async () => {
    throw new Error('ENODATA')
  }
}

const card = (uid: string, name: string, ...emails: string[]): string =>
  [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `UID:${uid}`,
    `FN:${name}`,
    ...emails.map((e) => `EMAIL;TYPE=WORK:${e}`),
    'END:VCARD'
  ].join('\r\n')

let db: Database.Database
let server: FakeCardDavServer
let changed: number[]

beforeEach(() => {
  db = createTestDb()
  server = new FakeCardDavServer()
  server.addBook('contacts', 'Kontakte')
  server.addBook('team', 'Team')
  changed = []
})
afterEach(() => closeTestDb(db))

function seedCalAccount(): CalAccountRow {
  const r = db
    .prepare(
      `INSERT INTO cal_accounts (name, server_url, principal_url, home_url, username, created_at)
       VALUES ('Test', 'https://cal.test/dav/', ?, 'https://cal.test/dav/calendars/anna/', 'anna', 1)`
    )
    .run(`https://cal.test${PRINCIPAL}`)
  const id = Number(r.lastInsertRowid)
  setSecret(calSecretKey(id), 'pw')
  return getCalAccount(db, id)!
}

const ctx = (s = server): ContactsSyncContext => ({
  db,
  client: new DavClient({ username: 'anna', password: 'pw', fetch: s.fetch }),
  onChanged: (id) => changed.push(id)
})

async function enabledAccount(): Promise<CalAccountRow> {
  const account = seedCalAccount()
  await setContactsSync(db, account.id, true, { fetch: server.fetch, dns: noDns })
  return getCalAccount(db, account.id)!
}

const names = (): string[] =>
  (
    db.prepare('SELECT full_name FROM dav_contacts ORDER BY full_name').all() as Array<{
      full_name: string
    }>
  ).map((r) => r.full_name)

describe('CardDAV-Discovery', () => {
  it('findet Principal, addressbook-home-set und Adressbücher über den Kalender-Principal', async () => {
    const found = await discoverCardDav('https://cal.test/dav/', 'anna', 'pw', {
      fetch: server.fetch,
      dns: noDns,
      hints: [`https://cal.test${PRINCIPAL}`]
    })
    expect(found.homeUrl).toBe('https://cal.test/dav/addressbooks/users/anna/')
    expect(found.addressBooks.map((b) => b.displayName)).toEqual(['Kontakte', 'Team'])
    expect(found.addressBooks[0].supportsSyncCollection).toBe(true)
    expect(found.addressBooks[0].syncToken).toMatch(/^tok-/)
  })

  it('lehnt http:// ab (außer Loopback)', async () => {
    await expect(
      discoverCardDav('http://cal.test/dav/', 'anna', 'pw', { fetch: server.fetch, dns: noDns })
    ).rejects.toBeInstanceOf(Error)
    const { fetch, calls } = createMockFetch(() => ({ status: 404 }))
    const client = new DavClient({ username: 'a', password: 'b', fetch })
    await expect(client.propfind('http://cal.test/x/', '<x/>')).rejects.toBeInstanceOf(
      InsecureUrlError
    )
    expect(calls).toHaveLength(0)
  })

  it('SRV _carddavs._tcp nur innerhalb der Domain; well-known/carddav', async () => {
    const asked: string[] = []
    const dns: DnsResolver = {
      resolveSrv: async (name) => {
        asked.push(name)
        return [{ name: 'dav.attacker.example.', port: 443, priority: 0, weight: 0 }]
      },
      resolveTxt: async () => []
    }
    const { fetch, calls } = createMockFetch(() => ({ status: 404 }))
    await expect(
      discoverCardDav('anna@example.org', 'anna', 'pw', { fetch, dns })
    ).rejects.toThrow()
    expect(asked).toEqual(['_carddavs._tcp.example.org'])
    expect(calls.some((c) => c.url.includes('/.well-known/carddav'))).toBe(true)
    expect(calls.some((c) => c.url.includes('attacker'))).toBe(false)
  })

  it('401 → DavAuthError', async () => {
    server.forceStatus = 401
    await expect(
      discoverCardDav('https://cal.test/dav/', 'anna', 'pw', { fetch: server.fetch, dns: noDns })
    ).rejects.toBeInstanceOf(DavAuthError)
  })

  it('sendet keine Zugangsdaten an einen fremden Host (Hrefs auf andere Domains werden verworfen)', async () => {
    const { fetch, calls } = createMockFetch((req) => {
      if (req.method === 'PROPFIND' && req.url === 'https://cal.test/dav/') {
        return {
          status: 207,
          headers: { 'Content-Type': 'application/xml' },
          body: `<d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav"><d:response><d:href>/dav/</d:href><d:propstat><d:prop><card:addressbook-home-set><d:href>https://evil.example/ab/</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
        }
      }
      return { status: 404 }
    })
    await expect(
      discoverCardDav('https://cal.test/dav/', 'anna', 'pw', { fetch, dns: noDns })
    ).rejects.toThrow()
    expect(calls.some((c) => c.url.includes('evil.example'))).toBe(false)
  })
})

describe('Kontakt-Sync', () => {
  it('Erstabgleich per sync-collection, Foto wird weder gespeichert noch geladen', async () => {
    server.put(
      'contacts',
      'a.vcf',
      [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'FN:Anna Beispiel',
        'EMAIL:anna@beispiel.de',
        'PHOTO;VALUE=uri:https://tracker.example/p.png',
        'PHOTO;ENCODING=b;TYPE=JPEG:' + 'Q'.repeat(2000),
        'END:VCARD'
      ].join('\r\n')
    )
    server.put('team', 'b.vcf', card('b', 'Bernd Team', 'bernd@team.example'))
    const account = await enabledAccount()
    expect(contactsStatus(db, account.id).enabled).toBe(true)
    await syncAccountContacts(ctx(), account)

    expect(names()).toEqual(['Anna Beispiel', 'Bernd Team'])
    const raw = db
      .prepare('SELECT raw_vcard FROM dav_contacts WHERE full_name = ?')
      .get('Anna Beispiel') as { raw_vcard: string }
    expect(raw.raw_vcard).not.toContain('PHOTO')
    expect(raw.raw_vcard).not.toContain('QQQQ')
    expect(server.calls.every((c) => !c.url.includes('tracker.example'))).toBe(true)
    expect(server.calls.every((c) => !c.method.startsWith('GET'))).toBe(true)
    expect(changed).toEqual([account.id])
    expect(contactsStatus(db, account.id).lastSync).not.toBeNull()
    const status = contactsStatus(db, account.id)
    expect(status.addressBooks.map((b) => [b.displayName, b.contactCount])).toEqual([
      ['Kontakte', 1],
      ['Team', 1]
    ])
  })

  it('inkrementell: nur Änderungen werden geladen, Löschungen übernommen', async () => {
    server.put('contacts', 'a.vcf', card('a', 'Anna', 'anna@x.example'))
    server.put('contacts', 'b.vcf', card('b', 'Bernd', 'bernd@x.example'))
    const account = await enabledAccount()
    await syncAccountContacts(ctx(), account)
    expect(names()).toEqual(['Anna', 'Bernd'])

    server.put('contacts', 'a.vcf', card('a', 'Anna Neu', 'anna@x.example'))
    server.remove('contacts', 'b.vcf')
    server.put('contacts', 'c.vcf', card('c', 'Carla', 'carla@x.example'))
    server.calls.length = 0
    await syncAccountContacts(ctx(), getCalAccount(db, account.id)!)

    expect(names()).toEqual(['Anna Neu', 'Carla'])
    const multiget = server.callsOfKind('multiget')
    expect(multiget).toHaveLength(1)
    expect(multiget[0].body).toContain('a.vcf')
    expect(multiget[0].body).toContain('c.vcf')
    expect(multiget[0].body).not.toContain('b.vcf')
    // Gelöschte Karte verschwindet auch aus dem E-Mail-Index
    expect(searchDavContacts(db, 'bernd', 5)).toEqual([])
  })

  it('unveränderter ctag: kein Report', async () => {
    server.put('contacts', 'a.vcf', card('a', 'Anna', 'anna@x.example'))
    const account = await enabledAccount()
    await syncAccountContacts(ctx(), account)
    server.calls.length = 0
    await syncAccountContacts(ctx(), getCalAccount(db, account.id)!)
    expect(server.callsOfKind('sync-collection')).toHaveLength(0)
    expect(server.callsOfKind('multiget')).toHaveLength(0)
  })

  it('Fallback ohne sync-collection: ETag-Vergleich, Löschungen per Vollabgleich', async () => {
    server.supportsSync = false
    server.put('contacts', 'a.vcf', card('a', 'Anna', 'anna@x.example'))
    server.put('contacts', 'b.vcf', card('b', 'Bernd', 'bernd@x.example'))
    const account = await enabledAccount()
    await syncAccountContacts(ctx(), account)
    expect(names()).toEqual(['Anna', 'Bernd'])
    expect(server.callsOfKind('etags').length).toBeGreaterThan(0)

    server.remove('contacts', 'b.vcf')
    server.put('contacts', 'a.vcf', card('a', 'Anna 2', 'anna@x.example'))
    server.calls.length = 0
    await syncAccountContacts(ctx(), getCalAccount(db, account.id)!)
    expect(names()).toEqual(['Anna 2'])
    expect(server.callsOfKind('multiget')[0].body).not.toContain('b.vcf')
  })

  it('abgelehnter Token: vollständiger Neuabgleich', async () => {
    server.put('contacts', 'a.vcf', card('a', 'Anna', 'anna@x.example'))
    const account = await enabledAccount()
    await syncAccountContacts(ctx(), account)
    db.prepare(`UPDATE addressbooks SET sync_token = 'kaputt', ctag = NULL`).run()
    server.put('contacts', 'z.vcf', card('z', 'Zora', 'zora@x.example'))
    await syncAccountContacts(ctx(), getCalAccount(db, account.id)!)
    expect(names()).toEqual(['Anna', 'Zora'])
  })

  it('401 im Lauf → DavAuthError (needs-reauth der Konto-Schleife); sonstige Fehler nur vermerkt', async () => {
    const account = await enabledAccount()
    server.forceStatus = 401
    await expect(syncAccountContacts(ctx(), account)).rejects.toBeInstanceOf(DavAuthError)
    server.forceStatus = 500
    await syncAccountContacts(ctx(), account)
    expect(contactsStatus(db, account.id).error).toMatch(/500/)
  })

  it('deaktiviertes Adressbuch: Karten weg, wird nicht mehr abgeglichen; Ausschalten räumt auf', async () => {
    server.put('contacts', 'a.vcf', card('a', 'Anna', 'anna@x.example'))
    server.put('team', 'b.vcf', card('b', 'Bernd', 'bernd@x.example'))
    const account = await enabledAccount()
    await syncAccountContacts(ctx(), account)
    const team = db.prepare(`SELECT id FROM addressbooks WHERE display_name = 'Team'`).get() as {
      id: number
    }
    setAddressBookEnabled(db, team.id, false)
    expect(names()).toEqual(['Anna'])
    server.calls.length = 0
    server.put('team', 'c.vcf', card('c', 'Carla', 'carla@x.example'))
    await syncAccountContacts(ctx(), getCalAccount(db, account.id)!, { force: true })
    expect(names()).toEqual(['Anna'])
    expect(server.calls.some((c) => c.url.includes('/team/'))).toBe(false)

    await setContactsSync(db, account.id, false)
    expect(names()).toEqual([])
    expect(db.prepare('SELECT count(*) n FROM addressbooks').get()).toEqual({ n: 0 })
    expect(contactsStatus(db, account.id).enabled).toBe(false)
  })

  it('Konto ohne CardDAV: Einschalten schlägt mit lesbarer Meldung fehl', async () => {
    const account = seedCalAccount()
    server.books.clear()
    await expect(
      setContactsSync(db, account.id, true, { fetch: server.fetch, dns: noDns })
    ).rejects.toThrow(/CardDAV/)
    expect(contactsStatus(db, account.id).enabled).toBe(false)
  })
})

describe('Empfänger-Vorschläge: Historie + Adressbuch', () => {
  async function withContacts(): Promise<void> {
    server.put('contacts', 'a.vcf', card('a', 'Alice Adressbuch', 'alice@firma.de'))
    server.put(
      'contacts',
      'b.vcf',
      card('b', 'Bob Brandt', 'bob@brandt.example', 'bob2@brandt.example')
    )
    server.put('contacts', 'c.vcf', card('c', 'Carla Alicante', 'carla@x.example'))
    server.put('contacts', 'd.vcf', card('d', 'Tim Selbst', 'tim@test.de'))
    const account = await enabledAccount()
    await syncAccountContacts(ctx(), account)
  }

  it('Präfix-/Teilstring-Suche in Name und Adresse, Präfix zuerst', async () => {
    await withContacts()
    const hits = searchDavContacts(db, 'ali', 10).map((m) => m.addr)
    expect(hits).toEqual(['alice@firma.de', 'carla@x.example'])
    expect(searchDavContacts(db, 'brandt.example', 10).map((m) => m.addr)).toEqual([
      'bob2@brandt.example',
      'bob@brandt.example'
    ])
    // LIKE-Platzhalter aus der Eingabe sind wirkungslos
    expect(searchDavContacts(db, '%', 10)).toEqual([])
  })

  it('Historie zuerst, Adressbuch danach, Dedupe nach Adresse, eigene Adresse ausgeschlossen', async () => {
    const mailId = seedMailAccount(db, { email: 'tim@test.de' })
    db.prepare(
      `INSERT INTO contact_stats (account_id, addr, sent_count, received_count, last_interaction, display_name)
       VALUES (?, 'alice@firma.de', 2, 0, 1, NULL), (?, 'alina@web.de', 0, 5, 1, 'Alina Web')`
    ).run(mailId, mailId)
    await withContacts()

    const result = suggestContacts(db, 'ali', 8)
    expect(result.map((r) => r.addr)).toEqual(['alice@firma.de', 'alina@web.de', 'carla@x.example'])
    // Historie ohne Namen übernimmt den Adressbuch-Namen, vorhandener Name bleibt
    expect(result.map((r) => r.name)).toEqual(['Alice Adressbuch', 'Alina Web', 'Carla Alicante'])
    expect(suggestContacts(db, 'tim', 8).map((r) => r.addr)).not.toContain('tim@test.de')
  })

  it('limit gilt für das Gesamtergebnis; ohne Adressbuch unverändert', async () => {
    const mailId = seedMailAccount(db, { email: 'tim@test.de' })
    db.prepare(
      `INSERT INTO contact_stats (account_id, addr, sent_count, received_count, last_interaction, display_name)
       VALUES (?, 'ali1@web.de', 1, 0, 1, 'A1'), (?, 'ali2@web.de', 1, 0, 1, 'A2')`
    ).run(mailId, mailId)
    expect(
      suggestContacts(db, 'ali', 2)
        .map((r) => r.addr)
        .sort()
    ).toEqual(['ali1@web.de', 'ali2@web.de'])
    await withContacts()
    expect(suggestContacts(db, 'ali', 3)).toHaveLength(3)
    // Deaktiviertes Adressbuch liefert keine Vorschläge mehr
    const id = (
      db.prepare('SELECT id FROM addressbooks WHERE display_name = ?').get('Kontakte') as {
        id: number
      }
    ).id
    setAddressBookEnabled(db, id, false)
    expect(suggestContacts(db, 'alice', 5)).toEqual([])
  })
})
