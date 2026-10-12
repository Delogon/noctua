import { describe, expect, it } from 'vitest'
import { parseXml, XmlParseError, NS, child, children, escapeXml } from '@main/dav/xml'
import { parseMultistatus, okPropText } from '@main/dav/multistatus'
import {
  DavAuthError,
  DavClient,
  DavCrossOriginAuthError,
  DavHttpError,
  DavTransportError
} from '@main/dav/client'
import { assertSecureUrl, InsecureUrlError, normalizeHref, parseServerInput } from '@main/dav/url'
import { createMockFetch } from '../helpers/dav-mock'
import {
  EVIL_XXE,
  NEXTCLOUD_HOME_LISTING,
  RADICALE_HOME_LISTING,
  SYNC_COLLECTION_RESPONSE
} from './fixtures'

describe('xml parser', () => {
  it('löst Namespaces mit wechselnden Präfixen und Default-Namespace auf', () => {
    const nc = parseXml(NEXTCLOUD_HOME_LISTING)
    expect(nc.ns).toBe(NS.dav)
    expect(nc.name).toBe('multistatus')
    const radicale = parseXml(RADICALE_HOME_LISTING)
    expect(radicale.ns).toBe(NS.dav) // Default-Namespace
    expect(children(radicale, NS.dav, 'response')).toHaveLength(2)
  })

  it('verarbeitet Entities, CDATA und Zeichenreferenzen', () => {
    const root = parseXml(
      '<a xmlns="x"><b>1 &amp; 2 &lt;3&gt; &#65;&#x42;</b><c><![CDATA[<raw & text>]]></c></a>'
    )
    expect(root.children[0].text).toBe('1 & 2 <3> AB')
    expect(root.children[1].text).toBe('<raw & text>')
  })

  it('lehnt DOCTYPE/ENTITY ab (kein XXE, kein Billion Laughs)', () => {
    expect(() => parseXml(EVIL_XXE)).toThrow(XmlParseError)
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><x/>')).toThrow(/DTD/)
  })

  it('löst unbekannte Entities nicht auf', () => {
    const root = parseXml('<a>&xxe;</a>')
    expect(root.text).toBe('&xxe;')
  })

  it('begrenzt die Verschachtelungstiefe', () => {
    const deep = '<a>'.repeat(100) + '</a>'.repeat(100)
    expect(() => parseXml(deep)).toThrow(/tief/)
  })

  it('erkennt kaputtes XML', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(XmlParseError)
    expect(() => parseXml('<a>')).toThrow(XmlParseError)
    expect(() => parseXml('')).toThrow(XmlParseError)
    expect(() => parseXml('<a/><b/>')).toThrow(XmlParseError)
  })

  it('escapeXml neutralisiert Sonderzeichen', () => {
    expect(escapeXml(`<a href="x">&'`)).not.toMatch(/[<>"'&](?!#)/)
  })
})

describe('multistatus', () => {
  it('parst sync-collection mit Token, Änderungen und 404-Einträgen', () => {
    const ms = parseMultistatus(
      parseXml(SYNC_COLLECTION_RESPONSE),
      'https://cloud.example.com/remote.php/dav/'
    )
    expect(ms.syncToken).toBe('http://sabre.io/ns/sync/43')
    expect(ms.responses).toHaveLength(2)
    expect(ms.responses[0].href).toBe('/remote.php/dav/calendars/anna/personal/new@event.ics')
    expect(okPropText(ms.responses[0], NS.dav, 'getetag')).toBe('"etag-new"')
    expect(ms.responses[1].status).toBe(404)
  })

  it('normalisiert Hrefs (absolut, relativ, Prozent-Kodierung)', () => {
    const base = 'https://x.example/dav/'
    expect(normalizeHref('https://x.example:443/dav/a%40b.ics', base)).toBe('/dav/a@b.ics')
    expect(normalizeHref('a%2Fb.ics', base)).toBe('/dav/a%2Fb.ics')
    expect(normalizeHref('/dav/team%20kalender/', base)).toBe('/dav/team%20kalender/')
    expect(normalizeHref('/dav/ä.ics', base)).toBe('/dav/%C3%A4.ics')
  })

  it('wirft bei Nicht-Multistatus', () => {
    expect(() => parseMultistatus(parseXml('<x/>'), 'https://a/')).toThrow()
  })
})

describe('url policy', () => {
  it('lehnt http:// außer Loopback ab', () => {
    expect(() => assertSecureUrl(new URL('http://cloud.example.com/dav'))).toThrow(InsecureUrlError)
    expect(() => assertSecureUrl(new URL('http://localhost:5232/'))).not.toThrow()
    expect(() => assertSecureUrl(new URL('http://127.0.0.1:8080/'))).not.toThrow()
    expect(() => assertSecureUrl(new URL('http://[::1]:8080/'))).not.toThrow()
    expect(() => assertSecureUrl(new URL('https://cloud.example.com/'))).not.toThrow()
    expect(() => assertSecureUrl(new URL('ftp://x/'))).toThrow()
  })

  it('parseServerInput ergänzt https und verbietet Zugangsdaten in der URL', () => {
    expect(parseServerInput('cloud.example.com/remote.php/dav').toString()).toBe(
      'https://cloud.example.com/remote.php/dav'
    )
    expect(() => parseServerInput('http://evil.example.com')).toThrow(InsecureUrlError)
    expect(() => parseServerInput('https://user:pw@example.com')).toThrow(/Zugangsdaten/)
    expect(() => parseServerInput('  ')).toThrow()
  })
})

describe('DavClient', () => {
  const creds = { username: 'anna', password: 'geheim' }

  it('sendet Basic-Auth, Depth und XML-Body; verweigert http://', async () => {
    const { fetch, calls } = createMockFetch(() => ({
      status: 207,
      body: '<d:multistatus xmlns:d="DAV:"/>'
    }))
    const client = new DavClient({ ...creds, fetch })
    await client.propfind('https://cloud.example.com/dav/', '<x/>', '1')
    expect(calls[0].headers.authorization).toBe(
      `Basic ${Buffer.from('anna:geheim').toString('base64')}`
    )
    expect(calls[0].headers.depth).toBe('1')
    expect(calls[0].method).toBe('PROPFIND')
    await expect(client.propfind('http://cloud.example.com/dav/', '<x/>')).rejects.toThrow(
      InsecureUrlError
    )
    expect(calls).toHaveLength(1) // http-Request wurde nie abgesetzt
  })

  it('401 → DavAuthError, 412 → DavHttpError mit Status', async () => {
    const { fetch } = createMockFetch((req) =>
      req.method === 'PUT' ? { status: 412 } : { status: 401 }
    )
    const client = new DavClient({ ...creds, fetch })
    await expect(client.propfind('https://a.example/', '<x/>')).rejects.toBeInstanceOf(DavAuthError)
    await expect(
      client.put('https://a.example/x.ics', 'ics', { contentType: 'text/calendar', ifMatch: '"e"' })
    ).rejects.toMatchObject({ status: 412 })
  })

  it('liest DAV:error aus Fehlerantworten (valid-sync-token) und Retry-After', async () => {
    const { fetch } = createMockFetch(() => ({
      status: 403,
      headers: { 'content-type': 'application/xml', 'retry-after': '120' },
      body: '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>'
    }))
    const client = new DavClient({ ...creds, fetch })
    const error = (await client
      .report('https://a.example/c/', '<x/>')
      .catch((e) => e)) as DavHttpError
    expect(error.davError).toBe('valid-sync-token')
    expect(error.retryAfterMs).toBe(120_000)
  })

  it('PUT sendet If-Match bzw. If-None-Match und liefert den ETag', async () => {
    const { fetch, calls } = createMockFetch(() => ({ status: 201, headers: { etag: '"abc"' } }))
    const client = new DavClient({ ...creds, fetch })
    const created = await client.put('https://a.example/x.ics', 'b', {
      contentType: 'text/calendar',
      ifNoneMatch: true
    })
    expect(created.etag).toBe('"abc"')
    expect(calls[0].headers['if-none-match']).toBe('*')
    await client.put('https://a.example/x.ics', 'b', {
      contentType: 'text/calendar',
      ifMatch: '"abc"'
    })
    expect(calls[1].headers['if-match']).toBe('"abc"')
    await client.delete('https://a.example/x.ics', '"abc"')
    expect(calls[2].headers['if-match']).toBe('"abc"')
  })

  it('folgt Redirects gleichen Origins und behält Methode/Body', async () => {
    const { fetch, calls } = createMockFetch((req) =>
      req.url.endsWith('/.well-known/caldav')
        ? { status: 301, headers: { location: '/remote.php/dav/' } }
        : { status: 207, body: '<d:multistatus xmlns:d="DAV:"/>' }
    )
    const client = new DavClient({ ...creds, fetch })
    await client.propfind('https://cloud.example.com/.well-known/caldav', '<x/>')
    expect(calls[1].url).toBe('https://cloud.example.com/remote.php/dav/')
    expect(calls[1].method).toBe('PROPFIND')
    expect(calls[1].body).toBe('<x/>')
    expect(calls[1].headers.authorization).toBeDefined()
  })

  it('lehnt Redirect auf anderen Host ab (Sync) bzw. folgt nur über https (Discovery)', async () => {
    const redirect = (req: {
      url: string
    }): { status: number; headers?: Record<string, string>; body?: string } =>
      req.url.startsWith('https://a.example')
        ? { status: 302, headers: { location: 'https://b.example/dav/' } }
        : { status: 207, body: '<d:multistatus xmlns:d="DAV:"/>' }
    const strict = new DavClient({ ...creds, fetch: createMockFetch(redirect).fetch })
    await expect(strict.propfind('https://a.example/x', '<x/>')).rejects.toBeInstanceOf(
      DavTransportError
    )
    const lenient = new DavClient({
      ...creds,
      followCrossOrigin: true,
      fetch: createMockFetch(redirect).fetch
    })
    await expect(lenient.propfind('https://a.example/x', '<x/>')).resolves.toBeDefined()
  })

  it('schickt Zugangsdaten nie an einen fremden Host nach Umleitung', async () => {
    const { fetch, calls } = createMockFetch((req) =>
      req.url.startsWith('https://a.example')
        ? { status: 302, headers: { location: 'https://evil.example/dav/' } }
        : { status: 207, body: '<d:multistatus xmlns:d="DAV:"/>' }
    )
    const client = new DavClient({ ...creds, fetch, followCrossOrigin: true })
    await client.propfind('https://a.example/x', '<x/>')
    expect(calls[0].headers.authorization).toBeDefined()
    expect(calls[1].url).toBe('https://evil.example/dav/')
    expect(calls[1].headers.authorization).toBeUndefined()
  })

  it('verlangt ausdrückliche Bestätigung, wenn der fremde Host Anmeldung fordert', async () => {
    const { fetch } = createMockFetch((req) =>
      req.url.startsWith('https://a.example')
        ? { status: 301, headers: { location: 'https://dav.other.example/caldav/' } }
        : { status: 401 }
    )
    const client = new DavClient({ ...creds, fetch, followCrossOrigin: true })
    const error = await client.propfind('https://a.example/x', '<x/>').catch((e) => e)
    expect(error).toBeInstanceOf(DavCrossOriginAuthError)
    expect(error).toBeInstanceOf(DavAuthError)
    expect((error as DavCrossOriginAuthError).targetUrl).toBe('https://dav.other.example/caldav/')
  })

  it('lehnt Redirect von https auf http ab', async () => {
    const { fetch } = createMockFetch(() => ({
      status: 302,
      headers: { location: 'http://a.example/dav/' }
    }))
    const client = new DavClient({ ...creds, fetch, followCrossOrigin: true })
    await expect(client.propfind('https://a.example/x', '<x/>')).rejects.toThrow(
      /http|Unverschlüsselt/
    )
  })

  it('bricht bei zu großer Antwort ab und begrenzt Redirect-Schleifen', async () => {
    const big = createMockFetch(() => ({ status: 207, body: 'x'.repeat(5000) }))
    const client = new DavClient({ ...creds, fetch: big.fetch, maxResponseBytes: 1000 })
    await expect(client.propfind('https://a.example/', '<x/>')).rejects.toThrow(/zu groß/)

    const loop = createMockFetch(() => ({ status: 302, headers: { location: '/again' } }))
    const looping = new DavClient({ ...creds, fetch: loop.fetch, maxRedirects: 3 })
    await expect(looping.propfind('https://a.example/', '<x/>')).rejects.toThrow(/Umleitungen/)
  })

  it('übersetzt Netzwerkfehler und Timeouts', async () => {
    const failing = new DavClient({
      ...creds,
      fetch: async () => {
        throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } })
      }
    })
    await expect(failing.propfind('https://nope.example/', '<x/>')).rejects.toThrow(/ENOTFOUND/)
  })

  it('child() findet Kinder nach Namespace', () => {
    const root = parseXml('<a xmlns="DAV:" xmlns:c="urn:c"><c:x/><x/></a>')
    expect(child(root, 'urn:c', 'x')).toBeDefined()
    expect(child(root, 'urn:c', 'y')).toBeUndefined()
  })
})
