import { promises as dns } from 'node:dns'
import {
  DavAuthError,
  DavClient,
  DavError,
  DavHttpError,
  DavTransportError,
  type DavClientOptions
} from './client'
import {
  childNames,
  okProp,
  okPropUrl,
  okPropText,
  type DavResponse,
  type Multistatus
} from './multistatus'
import { children, escapeXml, NS, textOf } from './xml'
import { isRelatedHost, normalizeCollectionHref, parseServerInput } from './url'

/**
 * CalDAV layer (RFC 4791, 6764, 6578, 6638 detection) on top of the DavClient:
 * discovery, calendar list, reports (calendar-query, multiget, sync-collection).
 */

export class SyncTokenInvalidError extends DavError {
  constructor() {
    super('Sync-Token ungültig — vollständiger Neuabgleich nötig')
    this.name = 'SyncTokenInvalidError'
  }
}

export interface DavCalendarInfo {
  /** Absolute, normalized collection URL (with trailing slash) */
  url: string
  displayName: string | null
  /** #RRGGBB or null */
  color: string | null
  /** e.g. ['VEVENT', 'VTODO'] */
  components: string[]
  ctag: string | null
  syncToken: string | null
  readOnly: boolean
  supportsSyncCollection: boolean
  description: string | null
  order: number | null
}

export interface DiscoveryResult {
  /** URL at which discovery succeeded (after redirects) */
  serverUrl: string
  principalUrl: string | null
  homeUrl: string
  scheduleInboxUrl: string | null
  scheduleOutboxUrl: string | null
  /** calendar-user-address-set (mailto:…) */
  userAddresses: string[]
  /** Normalized tokens of the DAV header */
  davCapabilities: string[]
  autoSchedule: boolean
  calendars: DavCalendarInfo[]
}

export interface SrvRecord {
  name: string
  port: number
  priority: number
  weight: number
}

export interface DnsResolver {
  resolveSrv(name: string): Promise<SrvRecord[]>
  resolveTxt(name: string): Promise<string[][]>
}

export const systemDns: DnsResolver = {
  resolveSrv: (name) => dns.resolveSrv(name),
  resolveTxt: (name) => dns.resolveTxt(name)
}

// --- Request bodies ------------------------------------------------------------

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>'
const ALL_NS =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"'

const PROPFIND_PRINCIPAL = `${XML_HEAD}<d:propfind ${ALL_NS}><d:prop><d:current-user-principal/><d:resourcetype/><c:calendar-home-set/></d:prop></d:propfind>`

const PROPFIND_PRINCIPAL_PROPS = `${XML_HEAD}<d:propfind ${ALL_NS}><d:prop><d:displayname/><c:calendar-home-set/><c:schedule-inbox-URL/><c:schedule-outbox-URL/><c:calendar-user-address-set/></d:prop></d:propfind>`

const PROPFIND_CALENDARS = `${XML_HEAD}<d:propfind ${ALL_NS}><d:prop><d:resourcetype/><d:displayname/><a:calendar-color/><a:calendar-order/><c:calendar-description/><c:supported-calendar-component-set/><cs:getctag/><d:sync-token/><d:current-user-privilege-set/><d:supported-report-set/></d:prop></d:propfind>`

const PROPFIND_STATE = `${XML_HEAD}<d:propfind ${ALL_NS}><d:prop><cs:getctag/><d:sync-token/></d:prop></d:propfind>`

const PROPFIND_ETAG = `${XML_HEAD}<d:propfind ${ALL_NS}><d:prop><d:getetag/></d:prop></d:propfind>`

const QUERY_ETAGS = `${XML_HEAD}<c:calendar-query ${ALL_NS}><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"/></c:filter></c:calendar-query>`

function multigetBody(hrefs: string[]): string {
  const list = hrefs.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join('')
  return `${XML_HEAD}<c:calendar-multiget ${ALL_NS}><d:prop><d:getetag/><c:calendar-data/></d:prop>${list}</c:calendar-multiget>`
}

function syncBody(token: string | null): string {
  const t = token ? `<d:sync-token>${escapeXml(token)}</d:sync-token>` : '<d:sync-token/>'
  return `${XML_HEAD}<d:sync-collection ${ALL_NS}>${t}<d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`
}

// --- Helpers --------------------------------------------------------------------

/** Reduce "#RRGGBBAA"/"#RGB"/"red" values to #RRGGBB; otherwise null. */
export function normalizeCalendarColor(raw: string | null): string | null {
  if (!raw) return null
  const v = raw.trim()
  const long = /^#([0-9a-fA-F]{6})(?:[0-9a-fA-F]{2})?$/.exec(v)
  if (long) return `#${long[1].toLowerCase()}`
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(v)
  if (short)
    return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
  return null
}

/** Normalize an Etag header value: quotes stay (for If-Match), as does the W/ prefix. */
export function cleanEtag(raw: string | null): string | null {
  if (!raw) return null
  const t = raw.trim()
  return t === '' ? null : t
}

/** Etag from <getetag> (property text): servers deliver it with quotes. */
export function propEtag(r: DavResponse): string | null {
  return cleanEtag(okPropText(r, NS.dav, 'getetag'))
}

function parsePrivileges(r: DavResponse): { known: boolean; writable: boolean } {
  const set = okProp(r, NS.dav, 'current-user-privilege-set')
  if (!set) return { known: false, writable: true }
  const names = new Set<string>()
  for (const priv of children(set, NS.dav, 'privilege')) {
    for (const c of priv.children) names.add(c.name)
  }
  const writable =
    names.has('all') || names.has('write') || names.has('write-content') || names.has('bind')
  return { known: true, writable }
}

function parseCalendarResponse(r: DavResponse): DavCalendarInfo | null {
  const types = childNames(okProp(r, NS.dav, 'resourcetype'))
  const resourceType = okProp(r, NS.dav, 'resourcetype')
  const isCalendar = (resourceType?.children ?? []).some(
    (c) => c.ns === NS.caldav && c.name === 'calendar'
  )
  if (!isCalendar) return null
  // Subscribed calendars (Nextcloud/Apple) are read-only
  const subscribed = types.has('subscribed')

  const compSet = okProp(r, NS.caldav, 'supported-calendar-component-set')
  const components = compSet
    ? children(compSet, NS.caldav, 'comp')
        .map((c) => (c.attrs.name ?? '').toUpperCase())
        .filter(Boolean)
    : ['VEVENT', 'VTODO']
  // Pure journal/freebusy calendars are of no interest
  if (!components.includes('VEVENT') && !components.includes('VTODO')) return null

  const reports = okProp(r, NS.dav, 'supported-report-set')
  const supportsSync = (reports ? reports.children : []).some((sr) =>
    sr.children.some((rep) =>
      rep.children.some((x) => x.ns === NS.dav && x.name === 'sync-collection')
    )
  )

  const orderRaw = okPropText(r, NS.apple, 'calendar-order')
  const order = orderRaw !== null && Number.isFinite(Number(orderRaw)) ? Number(orderRaw) : null
  const priv = parsePrivileges(r)

  return {
    url: collectionUrl(r.url),
    displayName: okPropText(r, NS.dav, 'displayname'),
    color: normalizeCalendarColor(okPropText(r, NS.apple, 'calendar-color')),
    components,
    ctag: okPropText(r, NS.cs, 'getctag'),
    syncToken: okPropText(r, NS.dav, 'sync-token'),
    readOnly: subscribed || (priv.known && !priv.writable),
    supportsSyncCollection: supportsSync,
    description: okPropText(r, NS.caldav, 'calendar-description'),
    order
  }
}

/** Absolute URL with trailing slash (collections). */
export function collectionUrl(url: string): string {
  const u = new URL(url)
  u.pathname = normalizeCollectionHref(u.pathname, u)
  return u.toString()
}

export function sameCollection(a: string, b: string): boolean {
  return a.replace(/\/+$/, '') === b.replace(/\/+$/, '')
}

// --- Discovery ------------------------------------------------------------------

/** Known providers whose servers cannot be guessed via SRV/well-known. */
const KNOWN_PROVIDERS: Record<string, string> = {
  'mailbox.org': 'https://dav.mailbox.org/',
  'fastmail.com': 'https://caldav.fastmail.com/dav/',
  'fastmail.fm': 'https://caldav.fastmail.com/dav/',
  'posteo.de': 'https://posteo.de:8443/',
  'posteo.net': 'https://posteo.de:8443/',
  'icloud.com': 'https://caldav.icloud.com/',
  'me.com': 'https://caldav.icloud.com/',
  'mac.com': 'https://caldav.icloud.com/'
}

/** Derive candidate URLs from a mail address or domain (RFC 6764 + provider table). */
export async function candidateUrlsForDomain(
  domain: string,
  resolver: DnsResolver = systemDns,
  service: 'caldav' | 'carddav' = 'caldav',
  providers: Record<string, string> = KNOWN_PROVIDERS
): Promise<string[]> {
  const lower = domain.toLowerCase()
  const out: string[] = []
  const known = providers[lower]
  if (known) out.push(known)
  out.push(`https://${lower}/.well-known/${service}`)
  try {
    const srv = (await resolver.resolveSrv(`_${service}s._tcp.${lower}`))
      .slice()
      .sort((a, b) => a.priority - b.priority || b.weight - a.weight)[0]
    const srvHost = srv?.name?.replace(/\.$/, '').toLowerCase()
    // RFC 6764 §8: unsigned DNS must not silently redirect credentials to a
    // foreign host — only use SRV targets within the own domain,
    // otherwise the user must enter the server address manually.
    if (srvHost && (srvHost === lower || srvHost.endsWith(`.${lower}`))) {
      const host = srvHost
      const port = srv.port && srv.port !== 443 ? `:${srv.port}` : ''
      let path = `/.well-known/${service}`
      try {
        const txt = await resolver.resolveTxt(`_${service}s._tcp.${lower}`)
        for (const rec of txt) {
          const entry = rec.join('').match(/^path=(\/.*)$/)
          if (entry) path = entry[1]
        }
      } catch {
        // no TXT → default path
      }
      out.push(`https://${host}${port}${path}`)
    }
  } catch {
    // no SRV record
  }
  out.push(`https://${lower}/`)
  return [...new Set(out)]
}

export interface DiscoverOptions {
  fetch?: DavClientOptions['fetch']
  timeoutMs?: number
  dns?: DnsResolver
}

export function looksLikeEmail(v: string): boolean {
  return /^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(v.trim())
}

export function looksLikeBareDomain(v: string): boolean {
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v.trim())
}

/**
 * Find the server and list calendars. `input` may be a URL (Nextcloud base
 * or DAV endpoint), a domain or a mail address.
 */
export async function discoverCalDav(
  input: string,
  username: string,
  password: string,
  options: DiscoverOptions = {}
): Promise<DiscoveryResult> {
  const trimmed = input.trim()
  const candidates: string[] = []

  if (looksLikeEmail(trimmed)) {
    candidates.push(...(await candidateUrlsForDomain(trimmed.split('@')[1], options.dns)))
  } else if (looksLikeBareDomain(trimmed)) {
    candidates.push(...(await candidateUrlsForDomain(trimmed, options.dns)))
  } else {
    const url = parseServerInput(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    if (path !== '') candidates.push(url.toString())
    candidates.push(`${url.origin}/.well-known/caldav`)
    // Nextcloud/ownCloud/Baïkal without a working well-known
    candidates.push(`${url.origin}/remote.php/dav/`, `${url.origin}/dav.php/`)
    candidates.push(`${url.origin}/`)
  }

  const client = new DavClient({
    username,
    password,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    followCrossOrigin: true
  })

  let lastError: unknown = null
  for (const candidate of [...new Set(candidates)]) {
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
    'Keinen CalDAV-Dienst gefunden — bitte die vollständige Server-Adresse angeben (bei Nextcloud z. B. https://cloud.example.com)'
  )
}

async function discoverFrom(client: DavClient, startUrl: string): Promise<DiscoveryResult | null> {
  // 1. Context: current-user-principal / calendar-home-set (Depth 0)
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

  // Final URL (after redirects) as the base for relative hrefs
  const base = first.baseUrl
  const self = first.responses[0]
  if (!self) return null

  const anchor = new URL(base)
  // Hrefs to foreign hosts are ignored: a server must not redirect the credentials
  // to another provider.
  const trusted = (url: string | null): string | null => {
    if (!url) return null
    try {
      return isRelatedHost(anchor, new URL(url)) ? collectionUrl(url) : null
    } catch {
      return null
    }
  }

  let principalUrl: string | null = trusted(okPropUrl(self, NS.dav, 'current-user-principal', base))
  if (!principalUrl && childNames(okProp(self, NS.dav, 'resourcetype')).has('principal')) {
    principalUrl = trusted(self.url)
  }

  let homeUrl: string | null = trusted(okPropUrl(self, NS.caldav, 'calendar-home-set', base))
  let scheduleInboxUrl: string | null = null
  let scheduleOutboxUrl: string | null = null
  let userAddresses: string[] = []

  if (principalUrl) {
    const pms = await client.propfind(principalUrl, PROPFIND_PRINCIPAL_PROPS, '0').catch(() => null)
    const pr = pms?.responses[0]
    if (pr && pms) {
      homeUrl = trusted(okPropUrl(pr, NS.caldav, 'calendar-home-set', pms.baseUrl)) ?? homeUrl
      scheduleInboxUrl = trusted(okPropUrl(pr, NS.caldav, 'schedule-inbox-URL', pms.baseUrl))
      scheduleOutboxUrl = trusted(okPropUrl(pr, NS.caldav, 'schedule-outbox-URL', pms.baseUrl))
      const addrSet = okProp(pr, NS.caldav, 'calendar-user-address-set')
      userAddresses = children(addrSet, NS.dav, 'href')
        .map((h) => textOf(h))
        .filter((h): h is string => !!h)
    }
  }

  // The entered URL could itself be the calendar home
  if (!homeUrl) homeUrl = collectionUrl(self.url)

  const calendars = await listCalendars(client, homeUrl)
  if (calendars.length === 0 && !principalUrl) return null

  let dav: string[] = []
  try {
    dav = (await client.optionsRequest(homeUrl)).dav
  } catch {
    // OPTIONS is only for capability detection
  }

  return {
    serverUrl: base,
    principalUrl,
    homeUrl,
    scheduleInboxUrl,
    scheduleOutboxUrl,
    userAddresses,
    davCapabilities: dav,
    autoSchedule: dav.includes('calendar-auto-schedule'),
    calendars
  }
}

// --- Calendar list & state --------------------------------------------------------

export async function listCalendars(
  client: DavClient,
  homeUrl: string
): Promise<DavCalendarInfo[]> {
  const ms = await client.propfind(homeUrl, PROPFIND_CALENDARS, '1')
  const out: DavCalendarInfo[] = []
  for (const r of ms.responses) {
    if (r.status !== null && r.status >= 400) continue
    const info = parseCalendarResponse(r)
    if (!info || sameCollection(info.url, homeUrl)) continue
    if (!isRelatedHost(new URL(homeUrl), new URL(info.url))) continue
    out.push(info)
  }
  return out
}

/** ctag + sync-token of a calendar (cheap change check). */
export async function getCalendarState(
  client: DavClient,
  calendarUrl: string
): Promise<{ ctag: string | null; syncToken: string | null }> {
  const ms = await client.propfind(calendarUrl, PROPFIND_STATE, '0')
  const r = ms.responses[0]
  return {
    ctag: r ? okPropText(r, NS.cs, 'getctag') : null,
    syncToken: r ? okPropText(r, NS.dav, 'sync-token') : null
  }
}

// --- Reports ----------------------------------------------------------------------

export interface EtagEntry {
  href: string
  etag: string | null
}

/** All objects of a calendar with ETag (calendar-query without data). */
export async function queryEtags(client: DavClient, calendarUrl: string): Promise<EtagEntry[]> {
  let ms: Multistatus
  try {
    ms = await client.report(calendarUrl, QUERY_ETAGS, '1')
  } catch (error) {
    // Some servers reject the empty comp-filter: PROPFIND Depth 1 as a fallback
    if (error instanceof DavHttpError && [400, 403, 501].includes(error.status)) {
      ms = await client.propfind(calendarUrl, PROPFIND_ETAG, '1')
    } else {
      throw error
    }
  }
  const out: EtagEntry[] = []
  for (const r of ms.responses) {
    if (r.status !== null && r.status >= 400) continue
    if (sameCollection(new URL(r.href, calendarUrl).toString(), calendarUrl)) continue
    const etag = propEtag(r)
    // The PROPFIND fallback also returns non-.ics children without ETag → skip
    if (!etag) continue
    out.push({ href: r.href, etag })
  }
  return out
}

export interface FetchedObject {
  href: string
  etag: string | null
  ics: string
}

/** calendar-multiget in chunks. Missing hrefs (404) are absent from the result. */
export async function multiget(
  client: DavClient,
  calendarUrl: string,
  hrefs: string[],
  batchSize = 40
): Promise<FetchedObject[]> {
  const out: FetchedObject[] = []
  for (let i = 0; i < hrefs.length; i += batchSize) {
    const batch = hrefs.slice(i, i + batchSize)
    const ms = await client.report(calendarUrl, multigetBody(batch), '1')
    for (const r of ms.responses) {
      if (r.status !== null && r.status >= 400) continue
      const data = okPropText(r, NS.caldav, 'calendar-data')
      if (!data) continue
      out.push({ href: r.href, etag: propEtag(r), ics: data })
    }
  }
  return out
}

export interface SyncCollectionResult {
  changed: EtagEntry[]
  removed: string[]
  syncToken: string | null
  /** Server truncated (507): request again with the new token */
  truncated: boolean
}

/**
 * sync-collection (RFC 6578). `token = null` → initial sync (all members).
 * Invalid token (403/409 valid-sync-token) → SyncTokenInvalidError.
 */
export async function syncCollection(
  client: DavClient,
  calendarUrl: string,
  token: string | null
): Promise<SyncCollectionResult> {
  let ms: Multistatus
  try {
    ms = await client.report(calendarUrl, syncBody(token), '0')
  } catch (error) {
    if (
      error instanceof DavHttpError &&
      (error.davError === 'valid-sync-token' ||
        error.status === 409 ||
        (error.status === 403 && token !== null) ||
        (error.status === 400 && token !== null))
    ) {
      throw new SyncTokenInvalidError()
    }
    throw error
  }
  const changed: EtagEntry[] = []
  const removed: string[] = []
  let truncated = false
  for (const r of ms.responses) {
    const isSelf = sameCollection(new URL(r.href, calendarUrl).toString(), calendarUrl)
    if (r.status === 507) {
      // RFC 6578 §3.6: result truncated, the token covers what was delivered so far
      if (isSelf) truncated = true
      continue
    }
    if (isSelf) continue
    if (r.status === 404) {
      removed.push(r.href)
      continue
    }
    if (r.status !== null && r.status >= 400) continue
    const etag = propEtag(r)
    // An entry without Etag (e.g. a sub-collection) is not a calendar object
    if (etag === null && r.propstats.some((p) => p.status === 404)) continue
    changed.push({ href: r.href, etag })
  }
  return { changed, removed, syncToken: ms.syncToken, truncated }
}

/** Fetch the ETag via PROPFIND (PUT returned none). */
export async function fetchEtag(client: DavClient, objectUrl: string): Promise<string | null> {
  const ms = await client.propfind(objectUrl, PROPFIND_ETAG, '0')
  const r = ms.responses[0]
  return r ? propEtag(r) : null
}
