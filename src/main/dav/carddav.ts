import {
  DavAuthError,
  DavClient,
  DavError,
  DavHttpError,
  DavTransportError,
  type DavClientOptions
} from './client'
import {
  candidateUrlsForDomain,
  collectionUrl,
  looksLikeBareDomain,
  looksLikeEmail,
  propEtag,
  sameCollection,
  type DnsResolver,
  type EtagEntry
} from './caldav'
import { childNames, okProp, okPropText, okPropUrl } from './multistatus'
import { escapeXml, NS } from './xml'
import { isRelatedHost, parseServerInput } from './url'

/**
 * CardDAV-Schicht (RFC 6352) auf dem DavClient: Discovery (.well-known/carddav,
 * `_carddavs._tcp`-SRV nur innerhalb der Domain), Adressbuchliste, Reports
 * (addressbook-multiget; sync-collection und ETag-Listen teilen sich die
 * Funktionen aus caldav.ts, sie sind nicht CalDAV-spezifisch).
 */

export interface DavAddressBookInfo {
  /** Absolute, normalisierte Collection-URL (mit Slash am Ende) */
  url: string
  displayName: string | null
  ctag: string | null
  syncToken: string | null
  supportsSyncCollection: boolean
}

export interface CardDavDiscovery {
  serverUrl: string
  principalUrl: string | null
  homeUrl: string
  addressBooks: DavAddressBookInfo[]
}

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>'
const NS_ATTRS =
  'xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/"'

const PROPFIND_PRINCIPAL = `${XML_HEAD}<d:propfind ${NS_ATTRS}><d:prop><d:current-user-principal/><d:resourcetype/><card:addressbook-home-set/></d:prop></d:propfind>`
const PROPFIND_PRINCIPAL_HOME = `${XML_HEAD}<d:propfind ${NS_ATTRS}><d:prop><card:addressbook-home-set/></d:prop></d:propfind>`
const PROPFIND_BOOKS = `${XML_HEAD}<d:propfind ${NS_ATTRS}><d:prop><d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/><d:supported-report-set/></d:prop></d:propfind>`
const PROPFIND_ETAGS = `${XML_HEAD}<d:propfind ${NS_ATTRS}><d:prop><d:getetag/></d:prop></d:propfind>`

function multigetBody(hrefs: string[]): string {
  const list = hrefs.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join('')
  return `${XML_HEAD}<card:addressbook-multiget ${NS_ATTRS}><d:prop><d:getetag/><card:address-data/></d:prop>${list}</card:addressbook-multiget>`
}

/** CardDAV-Server großer Anbieter, die sich nicht per SRV/well-known erraten lassen. */
const KNOWN_CARDDAV_PROVIDERS: Record<string, string> = {
  'mailbox.org': 'https://dav.mailbox.org/',
  'fastmail.com': 'https://carddav.fastmail.com/dav/',
  'fastmail.fm': 'https://carddav.fastmail.com/dav/',
  'posteo.de': 'https://posteo.de:8843/',
  'posteo.net': 'https://posteo.de:8843/',
  'icloud.com': 'https://contacts.icloud.com/',
  'me.com': 'https://contacts.icloud.com/',
  'mac.com': 'https://contacts.icloud.com/'
}

export interface CardDavDiscoverOptions {
  fetch?: DavClientOptions['fetch']
  timeoutMs?: number
  dns?: DnsResolver
  /** Zusätzliche Start-URLs vor den abgeleiteten (z. B. der Principal des Kalender-Kontos) */
  hints?: string[]
}

/**
 * Server finden und Adressbücher auflisten. `input` darf URL, Domain oder
 * Mail-Adresse sein; Zugangsdaten gehen nur an den Origin der jeweiligen
 * Kandidaten-URL, Hrefs auf fremde Hosts werden verworfen.
 */
export async function discoverCardDav(
  input: string,
  username: string,
  password: string,
  options: CardDavDiscoverOptions = {}
): Promise<CardDavDiscovery> {
  const trimmed = input.trim()
  const candidates: string[] = []
  if (looksLikeEmail(trimmed)) {
    candidates.push(
      ...(await candidateUrlsForDomain(
        trimmed.split('@')[1],
        options.dns,
        'carddav',
        KNOWN_CARDDAV_PROVIDERS
      ))
    )
  } else if (looksLikeBareDomain(trimmed)) {
    candidates.push(
      ...(await candidateUrlsForDomain(trimmed, options.dns, 'carddav', KNOWN_CARDDAV_PROVIDERS))
    )
  } else {
    const url = parseServerInput(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    if (path !== '') candidates.push(url.toString())
    candidates.push(`${url.origin}/.well-known/carddav`)
    candidates.push(`${url.origin}/remote.php/dav/`, `${url.origin}/dav.php/`)
    candidates.push(`${url.origin}/`)
  }
  const hints = (options.hints ?? []).filter((h) => {
    try {
      parseServerInput(h)
      return true
    } catch {
      return false
    }
  })

  const client = new DavClient({
    username,
    password,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    followCrossOrigin: true
  })

  let lastError: unknown = null
  for (const candidate of [...new Set([...hints, ...candidates])]) {
    try {
      const result = await discoverFrom(client, candidate)
      if (result) return result
    } catch (error) {
      if (error instanceof DavAuthError) throw error
      lastError = error
    }
  }
  if (lastError instanceof DavTransportError) throw lastError
  throw new DavError(
    'Keinen CardDAV-Dienst gefunden — der Server bietet für dieses Konto keine Kontakte an'
  )
}

async function discoverFrom(client: DavClient, startUrl: string): Promise<CardDavDiscovery | null> {
  const first = await client.propfind(startUrl, PROPFIND_PRINCIPAL, '0').catch((error) => {
    if (
      error instanceof DavHttpError &&
      [404, 405, 403, 400, 501, 502, 503].includes(error.status)
    ) {
      return null
    }
    throw error
  })
  if (!first) return null
  const base = first.baseUrl
  const self = first.responses[0]
  if (!self) return null

  const anchor = new URL(base)
  const trusted = (url: string | null): string | null => {
    if (!url) return null
    try {
      return isRelatedHost(anchor, new URL(url)) ? collectionUrl(url) : null
    } catch {
      return null
    }
  }

  let principalUrl = trusted(okPropUrl(self, NS.dav, 'current-user-principal', base))
  if (!principalUrl && childNames(okProp(self, NS.dav, 'resourcetype')).has('principal')) {
    principalUrl = trusted(self.url)
  }
  let homeUrl = trusted(okPropUrl(self, NS.carddav, 'addressbook-home-set', base))
  if (!homeUrl && principalUrl) {
    const pms = await client.propfind(principalUrl, PROPFIND_PRINCIPAL_HOME, '0').catch(() => null)
    const pr = pms?.responses[0]
    if (pr && pms) homeUrl = trusted(okPropUrl(pr, NS.carddav, 'addressbook-home-set', pms.baseUrl))
  }
  // Die eingegebene URL könnte selbst das Adressbuch-Home sein
  if (!homeUrl) homeUrl = collectionUrl(self.url)

  const addressBooks = await listAddressBooks(client, homeUrl)
  if (addressBooks.length === 0) return null
  return { serverUrl: base, principalUrl, homeUrl, addressBooks }
}

export async function listAddressBooks(
  client: DavClient,
  homeUrl: string
): Promise<DavAddressBookInfo[]> {
  const ms = await client.propfind(homeUrl, PROPFIND_BOOKS, '1')
  const out: DavAddressBookInfo[] = []
  for (const r of ms.responses) {
    if (r.status !== null && r.status >= 400) continue
    const type = okProp(r, NS.dav, 'resourcetype')
    if (!(type?.children ?? []).some((c) => c.ns === NS.carddav && c.name === 'addressbook'))
      continue
    const url = collectionUrl(r.url)
    if (sameCollection(url, homeUrl)) continue
    if (!isRelatedHost(new URL(homeUrl), new URL(url))) continue
    const reports = okProp(r, NS.dav, 'supported-report-set')
    const supportsSync = (reports ? reports.children : []).some((sr) =>
      sr.children.some((rep) =>
        rep.children.some((x) => x.ns === NS.dav && x.name === 'sync-collection')
      )
    )
    out.push({
      url,
      displayName: okPropText(r, NS.dav, 'displayname'),
      ctag: okPropText(r, NS.cs, 'getctag'),
      syncToken: okPropText(r, NS.dav, 'sync-token'),
      supportsSyncCollection: supportsSync
    })
  }
  return out
}

/** Alle Karten eines Adressbuchs mit ETag (PROPFIND Depth 1; Collections haben keinen ETag). */
export async function queryCardEtags(client: DavClient, bookUrl: string): Promise<EtagEntry[]> {
  const ms = await client.propfind(bookUrl, PROPFIND_ETAGS, '1')
  const out: EtagEntry[] = []
  for (const r of ms.responses) {
    if (r.status !== null && r.status >= 400) continue
    if (sameCollection(r.url, bookUrl)) continue
    const etag = propEtag(r)
    if (!etag) continue
    out.push({ href: r.href, etag })
  }
  return out
}

export interface FetchedCard {
  href: string
  etag: string | null
  vcard: string
}

/**
 * addressbook-multiget in Blöcken. Vollständige Karten (Fotos stecken inline
 * darin) können Antworten aufblähen: bei „Antwort zu groß" wird der Block
 * halbiert, eine einzelne zu große Karte wird übersprungen.
 */
export async function multigetCards(
  client: DavClient,
  bookUrl: string,
  hrefs: string[],
  batchSize = 25
): Promise<FetchedCard[]> {
  const out: FetchedCard[] = []
  const fetchBatch = async (batch: string[]): Promise<void> => {
    try {
      const ms = await client.report(bookUrl, multigetBody(batch), '1')
      for (const r of ms.responses) {
        if (r.status !== null && r.status >= 400) continue
        const data = okPropText(r, NS.carddav, 'address-data')
        if (data) out.push({ href: r.href, etag: propEtag(r), vcard: data })
      }
    } catch (error) {
      if (error instanceof DavTransportError && /zu groß/.test(error.message)) {
        if (batch.length === 1) return
        const mid = Math.ceil(batch.length / 2)
        await fetchBatch(batch.slice(0, mid))
        await fetchBatch(batch.slice(mid))
        return
      }
      throw error
    }
  }
  for (let i = 0; i < hrefs.length; i += batchSize) await fetchBatch(hrefs.slice(i, i + batchSize))
  return out
}
