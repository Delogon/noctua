import { describe, expect, it } from 'vitest'
import { DavClient, DavAuthError } from '@main/dav/client'
import {
  candidateUrlsForDomain,
  discoverCalDav,
  listCalendars,
  multiget,
  normalizeCalendarColor,
  queryEtags,
  syncCollection,
  SyncTokenInvalidError,
  type DnsResolver
} from '@main/dav/caldav'
import {
  createMockFetch,
  multistatus,
  respData,
  respEtag,
  respGone,
  XML_CT
} from '../helpers/dav-mock'
import {
  ICLOUD_HOME_LISTING,
  NEXTCLOUD_HOME_LISTING,
  RADICALE_HOME_LISTING,
  SYNC_COLLECTION_RESPONSE,
  ics
} from './fixtures'

const noDns: DnsResolver = {
  resolveSrv: async () => {
    throw new Error('ENODATA')
  },
  resolveTxt: async () => {
    throw new Error('ENODATA')
  }
}

const ok207 = (
  body: string
): { status: number; headers: Record<string, string>; body: string } => ({
  status: 207,
  headers: XML_CT,
  body
})

const principalReply = (principal: string): string =>
  `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>${principal}</d:href></d:current-user-principal></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`

describe('listCalendars', () => {
  const client = (body: string): DavClient =>
    new DavClient({
      username: 'u',
      password: 'p',
      fetch: createMockFetch(() => ok207(body)).fetch
    })

  it('Nextcloud: Kalender, Farbe ohne Alpha, Rechte, Subscribed, Inbox/Journal ausgefiltert', async () => {
    const cals = await listCalendars(
      client(NEXTCLOUD_HOME_LISTING),
      'https://cloud.example.com/remote.php/dav/calendars/anna/'
    )
    expect(cals.map((c) => c.displayName)).toEqual(['Persönlich', 'Team', 'Geburtstage'])
    const personal = cals[0]
    expect(personal.url).toBe('https://cloud.example.com/remote.php/dav/calendars/anna/personal/')
    expect(personal.color).toBe('#0082c9')
    expect(personal.components).toEqual(['VEVENT', 'VTODO'])
    expect(personal.readOnly).toBe(false)
    expect(personal.supportsSyncCollection).toBe(true)
    expect(personal.ctag).toBe('http://sabre.io/ns/sync/42')
    expect(personal.syncToken).toBe('http://sabre.io/ns/sync/42')
    const team = cals[1]
    expect(team.url).toBe(
      'https://cloud.example.com/remote.php/dav/calendars/anna/team%20kalender/'
    )
    expect(team.color).toBe('#ff7f00')
    expect(team.readOnly).toBe(true) // nur read-Privileg
    expect(cals[2].readOnly).toBe(true) // subscribed
  })

  it('Radicale: Default-Namespace, ctag mit Anführungszeichen, ohne supported-report-set', async () => {
    const cals = await listCalendars(client(RADICALE_HOME_LISTING), 'https://dav.example.org/bob/')
    expect(cals).toHaveLength(1)
    expect(cals[0].displayName).toBe('Arbeit')
    expect(cals[0].color).toBe('#e8710a')
    expect(cals[0].ctag).toBe('"a1b2c3"')
    expect(cals[0].supportsSyncCollection).toBe(false)
    expect(cals[0].readOnly).toBe(false) // keine Privilegien gemeldet → schreibbar annehmen
  })

  it('iCloud: absolute Hrefs mit Port, Alpha-Farbe, write-content/bind', async () => {
    const cals = await listCalendars(
      client(ICLOUD_HOME_LISTING),
      'https://caldav.icloud.com/1234567/calendars/'
    )
    expect(cals).toHaveLength(1)
    expect(cals[0].url).toBe('https://p01-caldav.icloud.com/1234567/calendars/home/')
    expect(cals[0].color).toBe('#1badf8')
    expect(cals[0].readOnly).toBe(false)
    expect(cals[0].supportsSyncCollection).toBe(true)
  })

  it('ignoriert Kalender auf fremden Hosts (Credential-Umleitung)', async () => {
    const evil = ICLOUD_HOME_LISTING.replace('p01-caldav.icloud.com:443', 'evil.example.net')
    const cals = await listCalendars(client(evil), 'https://caldav.icloud.com/1234567/calendars/')
    expect(cals).toHaveLength(0)
  })

  it('normalizeCalendarColor', () => {
    expect(normalizeCalendarColor('#ABC')).toBe('#aabbcc')
    expect(normalizeCalendarColor('#112233FF')).toBe('#112233')
    expect(normalizeCalendarColor('blue')).toBeNull()
    expect(normalizeCalendarColor(null)).toBeNull()
  })
})

describe('discovery', () => {
  const nextcloudServer = (calls?: string[]): ReturnType<typeof createMockFetch> =>
    createMockFetch((req) => {
      calls?.push(`${req.method} ${req.url}`)
      const url = new URL(req.url)
      if (url.pathname === '/.well-known/caldav') {
        return { status: 301, headers: { location: '/remote.php/dav/' } }
      }
      if (req.method === 'OPTIONS') {
        return {
          status: 200,
          headers: {
            DAV: '1, 3, extended-mkcol, calendar-access, calendar-auto-schedule, calendarserver-sharing'
          }
        }
      }
      if (req.method === 'PROPFIND' && url.pathname === '/remote.php/dav/') {
        return ok207(principalReply('/remote.php/dav/principals/users/anna/'))
      }
      if (url.pathname === '/remote.php/dav/principals/users/anna/') {
        return ok207(
          `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/remote.php/dav/principals/users/anna/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/remote.php/dav/calendars/anna/</d:href></c:calendar-home-set><c:schedule-inbox-URL><d:href>/remote.php/dav/calendars/anna/inbox/</d:href></c:schedule-inbox-URL><c:schedule-outbox-URL><d:href>/remote.php/dav/calendars/anna/outbox/</d:href></c:schedule-outbox-URL><c:calendar-user-address-set><d:href>mailto:anna@example.com</d:href></c:calendar-user-address-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>`
        )
      }
      if (url.pathname === '/remote.php/dav/calendars/anna/') return ok207(NEXTCLOUD_HOME_LISTING)
      return { status: 404 }
    })

  it('Nextcloud über well-known: Principal, Home, Scheduling, Kalender', async () => {
    const calls: string[] = []
    const { fetch } = nextcloudServer(calls)
    const result = await discoverCalDav('cloud.example.com', 'anna', 'pw', { fetch, dns: noDns })
    expect(result.principalUrl).toBe(
      'https://cloud.example.com/remote.php/dav/principals/users/anna/'
    )
    expect(result.homeUrl).toBe('https://cloud.example.com/remote.php/dav/calendars/anna/')
    expect(result.scheduleInboxUrl).toBe(
      'https://cloud.example.com/remote.php/dav/calendars/anna/inbox/'
    )
    expect(result.scheduleOutboxUrl).toBe(
      'https://cloud.example.com/remote.php/dav/calendars/anna/outbox/'
    )
    expect(result.userAddresses).toEqual(['mailto:anna@example.com'])
    expect(result.autoSchedule).toBe(true)
    expect(result.davCapabilities).toContain('calendar-access')
    expect(result.calendars).toHaveLength(3)
    expect(calls[0]).toBe('PROPFIND https://cloud.example.com/.well-known/caldav')
  })

  it('Mail-Adresse: Anbieter-Tabelle zuerst, dann well-known, dann SRV', async () => {
    const urls = await candidateUrlsForDomain('mailbox.org', noDns)
    expect(urls[0]).toBe('https://dav.mailbox.org/')
    expect(urls).toContain('https://mailbox.org/.well-known/caldav')
  })

  it('SRV _caldavs._tcp inkl. TXT-Pfad (RFC 6764)', async () => {
    const dns: DnsResolver = {
      resolveSrv: async (name) => {
        expect(name).toBe('_caldavs._tcp.example.org')
        return [
          { name: 'low.example.org.', port: 8443, priority: 20, weight: 1 },
          { name: 'dav.example.org.', port: 8443, priority: 10, weight: 5 }
        ]
      },
      resolveTxt: async () => [['path=/caldav/']]
    }
    const urls = await candidateUrlsForDomain('example.org', dns)
    expect(urls).toContain('https://dav.example.org:8443/caldav/')
    expect(urls).toContain('https://example.org/.well-known/caldav')
  })

  it('ignoriert SRV-Ziele außerhalb der eigenen Domain (Credential-Umlenkung)', async () => {
    const dns: DnsResolver = {
      resolveSrv: async () => [
        { name: 'dav.attacker.example.', port: 443, priority: 0, weight: 0 }
      ],
      resolveTxt: async () => []
    }
    const urls = await candidateUrlsForDomain('example.org', dns)
    expect(urls.some((u) => u.includes('attacker'))).toBe(false)
    expect(urls).toContain('https://example.org/.well-known/caldav')
  })

  it('Voller URL-Pfad wird zuerst probiert; Fallback auf remote.php/dav', async () => {
    const calls: string[] = []
    const { fetch } = createMockFetch((req) => {
      calls.push(req.url)
      const url = new URL(req.url)
      if (req.method === 'OPTIONS') return { status: 200, headers: { DAV: '1, calendar-access' } }
      if (url.pathname === '/remote.php/dav/')
        return ok207(principalReply('/remote.php/dav/principals/users/anna/'))
      if (url.pathname.includes('/principals/')) {
        return ok207(
          '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/p/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/remote.php/dav/calendars/anna/</d:href></c:calendar-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response></d:multistatus>'
        )
      }
      if (url.pathname === '/remote.php/dav/calendars/anna/') return ok207(NEXTCLOUD_HOME_LISTING)
      return { status: 404 }
    })
    const result = await discoverCalDav('https://cloud.example.com', 'anna', 'pw', {
      fetch,
      dns: noDns
    })
    expect(result.calendars.length).toBeGreaterThan(0)
    expect(result.autoSchedule).toBe(false)
    expect(calls[0]).toBe('https://cloud.example.com/.well-known/caldav')
    expect(calls).toContain('https://cloud.example.com/remote.php/dav/')
  })

  it('URL direkt auf den Kalender-Home: Kalender werden trotzdem gefunden', async () => {
    const { fetch } = createMockFetch((req) => {
      if (req.method === 'OPTIONS') return { status: 200, headers: { DAV: '1, calendar-access' } }
      if (req.method === 'PROPFIND' && req.headers.depth === '0') {
        return ok207(
          '<multistatus xmlns="DAV:"><response><href>/bob/</href><propstat><prop><resourcetype><collection/></resourcetype></prop><status>HTTP/1.1 200 OK</status></propstat></response></multistatus>'
        )
      }
      if (req.method === 'PROPFIND') return ok207(RADICALE_HOME_LISTING)
      return { status: 404 }
    })
    const result = await discoverCalDav('https://dav.example.org/bob/', 'bob', 'pw', {
      fetch,
      dns: noDns
    })
    expect(result.homeUrl).toBe('https://dav.example.org/bob/')
    expect(result.calendars[0].displayName).toBe('Arbeit')
  })

  it('401 bricht sofort mit DavAuthError ab', async () => {
    const { fetch, calls } = createMockFetch(() => ({ status: 401 }))
    await expect(
      discoverCalDav('cloud.example.com', 'anna', 'falsch', { fetch, dns: noDns })
    ).rejects.toBeInstanceOf(DavAuthError)
    expect(calls).toHaveLength(1)
  })

  it('kein Dienst gefunden → verständlicher Fehler; http:// abgelehnt', async () => {
    const { fetch } = createMockFetch(() => ({ status: 404 }))
    await expect(
      discoverCalDav('cloud.example.com', 'a', 'b', { fetch, dns: noDns })
    ).rejects.toThrow(/Keinen CalDAV-Dienst/)
    await expect(
      discoverCalDav('http://cloud.example.com', 'a', 'b', { fetch, dns: noDns })
    ).rejects.toThrow(/https/)
  })
})

describe('reports', () => {
  const calUrl = 'https://cloud.example.com/remote.php/dav/calendars/anna/personal/'

  it('queryEtags liefert Hrefs mit ETag und überspringt die Collection selbst', async () => {
    const { fetch, calls } = createMockFetch(() =>
      multistatus(
        respEtag('/remote.php/dav/calendars/anna/personal/', '"coll"') +
          respEtag('/remote.php/dav/calendars/anna/personal/a.ics', '"1"') +
          respEtag('/remote.php/dav/calendars/anna/personal/b%40c.ics', '"2"')
      )
    )
    const client = new DavClient({ username: 'u', password: 'p', fetch })
    const out = await queryEtags(client, calUrl)
    expect(out).toEqual([
      { href: '/remote.php/dav/calendars/anna/personal/a.ics', etag: '"1"' },
      { href: '/remote.php/dav/calendars/anna/personal/b@c.ics', etag: '"2"' }
    ])
    expect(calls[0].body).toContain('calendar-query')
  })

  it('multiget batcht und liest calendar-data', async () => {
    const hrefs = Array.from(
      { length: 5 },
      (_, i) => `/remote.php/dav/calendars/anna/personal/${i}.ics`
    )
    const { fetch, calls } = createMockFetch((req) => {
      const requested = [...req.body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((m) => m[1])
      return multistatus(
        requested
          .map((h) =>
            respData(h, '"e"', ics({ uid: h, summary: 'x', dtstart: 'DTSTART:20250101T100000Z' }))
          )
          .join('')
      )
    })
    const client = new DavClient({ username: 'u', password: 'p', fetch })
    const out = await multiget(client, calUrl, hrefs, 2)
    expect(out).toHaveLength(5)
    expect(calls).toHaveLength(3)
    expect(out[0].ics).toContain('BEGIN:VCALENDAR')
  })

  it('syncCollection: Änderungen, Löschungen, Token', async () => {
    const { fetch, calls } = createMockFetch(() => ok207(SYNC_COLLECTION_RESPONSE))
    const client = new DavClient({ username: 'u', password: 'p', fetch })
    const res = await syncCollection(client, calUrl, 'http://sabre.io/ns/sync/42')
    expect(res.changed).toEqual([
      { href: '/remote.php/dav/calendars/anna/personal/new@event.ics', etag: '"etag-new"' }
    ])
    expect(res.removed).toEqual(['/remote.php/dav/calendars/anna/personal/gone.ics'])
    expect(res.syncToken).toBe('http://sabre.io/ns/sync/43')
    expect(res.truncated).toBe(false)
    expect(calls[0].headers.depth).toBe('0')
    expect(calls[0].body).toContain('<d:sync-token>http://sabre.io/ns/sync/42</d:sync-token>')
  })

  it('syncCollection initial: leeres sync-token-Element', async () => {
    const { fetch, calls } = createMockFetch(() => ok207(SYNC_COLLECTION_RESPONSE))
    const client = new DavClient({ username: 'u', password: 'p', fetch })
    await syncCollection(client, calUrl, null)
    expect(calls[0].body).toContain('<d:sync-token/>')
  })

  it('syncCollection: 507 auf der Collection = gekürzt (weiter mit neuem Token)', async () => {
    const body =
      respEtag('/remote.php/dav/calendars/anna/personal/a.ics', '"1"') +
      `<d:response><d:href>/remote.php/dav/calendars/anna/personal/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response><d:sync-token>t2</d:sync-token>`
    const { fetch } = createMockFetch(() => multistatus(body))
    const res = await syncCollection(
      new DavClient({ username: 'u', password: 'p', fetch }),
      calUrl,
      't1'
    )
    expect(res.truncated).toBe(true)
    expect(res.changed).toHaveLength(1)
    expect(res.syncToken).toBe('t2')
  })

  it('syncCollection: ungültiges Token → SyncTokenInvalidError', async () => {
    const { fetch } = createMockFetch(() => ({
      status: 403,
      headers: { 'content-type': 'application/xml' },
      body: '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>'
    }))
    await expect(
      syncCollection(new DavClient({ username: 'u', password: 'p', fetch }), calUrl, 'old')
    ).rejects.toBeInstanceOf(SyncTokenInvalidError)
    const conflict = createMockFetch(() => ({ status: 409 }))
    await expect(
      syncCollection(
        new DavClient({ username: 'u', password: 'p', fetch: conflict.fetch }),
        calUrl,
        'old'
      )
    ).rejects.toBeInstanceOf(SyncTokenInvalidError)
  })

  it('respGone-Helper wird als Entfernung erkannt', async () => {
    const { fetch } = createMockFetch(() =>
      multistatus(
        respGone('/remote.php/dav/calendars/anna/personal/x.ics') + '<d:sync-token>t</d:sync-token>'
      )
    )
    const res = await syncCollection(
      new DavClient({ username: 'u', password: 'p', fetch }),
      calUrl,
      't0'
    )
    expect(res.removed).toEqual(['/remote.php/dav/calendars/anna/personal/x.ics'])
  })
})
