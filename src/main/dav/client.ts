import { assertSecureUrl, sameOrigin } from './url'
import { parseXml, XmlParseError, type XmlNode } from './xml'
import { parseMultistatus, type Multistatus } from './multistatus'

/**
 * Schlanker WebDAV-Client auf Node-`fetch`. Wiederverwendbar für CalDAV und
 * (später) CardDAV: PROPFIND, REPORT, PUT, DELETE, OPTIONS mit Timeouts,
 * Größenlimit, manueller Redirect-Behandlung und Basic-Auth nur über HTTPS.
 */

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class DavError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DavError'
  }
}

/** 401: Zugangsdaten falsch/abgelaufen → needs-reauth. */
export class DavAuthError extends DavError {
  readonly status = 401
  constructor(message = 'Anmeldung fehlgeschlagen (401)') {
    super(message)
    this.name = 'DavAuthError'
  }
}

export class DavHttpError extends DavError {
  constructor(
    readonly status: number,
    message: string,
    /** Name des DAV:error-Kindelements (z. B. valid-sync-token), falls geliefert */
    readonly davError: string | null = null,
    readonly retryAfterMs: number | null = null
  ) {
    super(message)
    this.name = 'DavHttpError'
  }
}

/**
 * 401 nach einer Umleitung auf einen anderen Host: Zugangsdaten werden dorthin
 * nie automatisch geschickt (DNS-SRV/Redirect könnten gefälscht sein). Der
 * Nutzer muss die neue Adresse ausdrücklich bestätigen bzw. eingeben.
 */
export class DavCrossOriginAuthError extends DavAuthError {
  constructor(readonly targetUrl: string) {
    super(
      `Der Server leitet zu ${new URL(targetUrl).host} weiter — bitte diese Adresse ausdrücklich als Server angeben (${targetUrl})`
    )
    this.name = 'DavCrossOriginAuthError'
  }
}

export class DavTransportError extends DavError {
  constructor(message: string) {
    super(message)
    this.name = 'DavTransportError'
  }
}

export interface DavClientOptions {
  username: string
  password: string
  fetch?: FetchLike
  timeoutMs?: number
  maxResponseBytes?: number
  maxRedirects?: number
  /**
   * Redirects auf einen anderen Origin (https) folgen und dabei Zugangsdaten
   * mitschicken. Nur für die Discovery (.well-known → anderer Host) sinnvoll;
   * im laufenden Sync führt ein Origin-Wechsel zum Fehler.
   */
  followCrossOrigin?: boolean
  userAgent?: string
}

export interface DavRequestInit {
  headers?: Record<string, string>
  body?: string
  depth?: '0' | '1' | 'infinity'
}

export interface DavResponseRaw {
  status: number
  headers: Headers
  text: string
  /** Finale URL nach Redirects */
  url: string
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024

export class DavClient {
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  private readonly maxBytes: number
  private readonly maxRedirects: number
  private readonly authHeader: string

  constructor(private readonly config: DavClientOptions) {
    this.fetchImpl = config.fetch ?? ((input, init) => fetch(input, init))
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.maxBytes = config.maxResponseBytes ?? DEFAULT_MAX_BYTES
    this.maxRedirects = config.maxRedirects ?? 5
    const token = Buffer.from(`${config.username}:${config.password}`, 'utf8').toString('base64')
    this.authHeader = `Basic ${token}`
  }

  /** Roher Request mit Redirect-Behandlung. Wirft nicht bei HTTP-Fehlerstatus. */
  async raw(method: string, url: string, init: DavRequestInit = {}): Promise<DavResponseRaw> {
    let current = new URL(url)
    const origin = current
    let curMethod = method
    let body = init.body

    for (let hop = 0; hop <= this.maxRedirects; hop++) {
      assertSecureUrl(current)
      const headers: Record<string, string> = {
        'User-Agent': this.config.userAgent ?? 'Noctua',
        Accept: '*/*',
        ...init.headers
      }
      // Zugangsdaten nur an den Ursprung, den der Nutzer angegeben hat
      if (sameOrigin(current, origin)) headers.Authorization = this.authHeader
      if (init.depth !== undefined) headers.Depth = init.depth

      let response: Response
      try {
        response = await this.fetchImpl(current.toString(), {
          method: curMethod,
          headers,
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeoutMs)
        })
      } catch (error) {
        throw new DavTransportError(describeFetchError(error))
      }

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        if (!location) throw new DavTransportError('Umleitung ohne Ziel')
        const next = new URL(location, current)
        assertSecureUrl(next)
        if (!sameOrigin(next, origin)) {
          if (!this.config.followCrossOrigin) {
            throw new DavTransportError(`Umleitung auf anderen Host (${next.host}) abgelehnt`)
          }
          // Gleicher Server-Betreiber nicht garantiert: nur https, nie von https auf http
          if (next.protocol !== 'https:')
            throw new DavTransportError('Umleitung auf http abgelehnt')
        }
        if (current.protocol === 'https:' && next.protocol !== 'https:') {
          throw new DavTransportError('Umleitung von https auf http abgelehnt')
        }
        // WebDAV: Methode und Body bleiben bei 301/302/307/308 erhalten; 303 → GET
        if (response.status === 303) {
          curMethod = 'GET'
          body = undefined
        }
        current = next
        continue
      }

      const text = await readLimited(response, this.maxBytes)
      return { status: response.status, headers: response.headers, text, url: current.toString() }
    }
    throw new DavTransportError('Zu viele Umleitungen')
  }

  /** Request mit Fehlerabbildung: 401 → DavAuthError, ≥ 400 → DavHttpError. */
  async request(method: string, url: string, init: DavRequestInit = {}): Promise<DavResponseRaw> {
    const res = await this.raw(method, url, init)
    if (res.status === 401) {
      if (!sameOrigin(new URL(res.url), new URL(url))) throw new DavCrossOriginAuthError(res.url)
      throw new DavAuthError()
    }
    if (res.status >= 400) throw httpError(res)
    return res
  }

  /** PROPFIND → Multistatus (207). */
  async propfind(url: string, body: string, depth: '0' | '1' = '0'): Promise<Multistatus> {
    const res = await this.request('PROPFIND', url, {
      depth,
      body,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' }
    })
    return parseMultistatusResponse(res, url)
  }

  /** REPORT → Multistatus. Fehlerstatus bleiben als DavHttpError mit davError erhalten. */
  async report(url: string, body: string, depth: '0' | '1' = '1'): Promise<Multistatus> {
    const res = await this.request('REPORT', url, {
      depth,
      body,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' }
    })
    return parseMultistatusResponse(res, url)
  }

  /** OPTIONS → Werte des DAV-Headers als Token-Liste. */
  async optionsRequest(url: string): Promise<{ dav: string[]; allow: string[] }> {
    const res = await this.request('OPTIONS', url)
    const split = (v: string | null): string[] =>
      (v ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    return { dav: split(res.headers.get('dav')), allow: split(res.headers.get('allow')) }
  }

  /**
   * PUT einer Ressource. `ifMatch` für Updates, `ifNoneMatch: true` für
   * Neuanlage (kein stilles Überschreiben). Liefert ETag (falls der Server
   * ihn mitschickt — sonst null und der Aufrufer muss nachladen).
   */
  async put(
    url: string,
    body: string,
    opts: { contentType: string; ifMatch?: string | null; ifNoneMatch?: boolean }
  ): Promise<{ status: number; etag: string | null }> {
    const headers: Record<string, string> = { 'Content-Type': opts.contentType }
    if (opts.ifMatch) headers['If-Match'] = opts.ifMatch
    if (opts.ifNoneMatch) headers['If-None-Match'] = '*'
    const res = await this.request('PUT', url, { headers, body })
    return { status: res.status, etag: res.headers.get('etag') }
  }

  async delete(url: string, ifMatch?: string | null): Promise<{ status: number }> {
    const headers: Record<string, string> = {}
    if (ifMatch) headers['If-Match'] = ifMatch
    const res = await this.request('DELETE', url, { headers })
    return { status: res.status }
  }

  async get(url: string): Promise<{ text: string; etag: string | null; status: number }> {
    const res = await this.request('GET', url)
    return { text: res.text, etag: res.headers.get('etag'), status: res.status }
  }
}

function httpError(res: DavResponseRaw): DavHttpError {
  let davError: string | null = null
  if (/xml/i.test(res.headers.get('content-type') ?? '') && res.text) {
    try {
      const root = parseXml(res.text)
      if (root.name === 'error') {
        davError = root.children[0]?.name ?? null
      }
    } catch {
      // kein lesbarer Fehlerkörper
    }
  }
  const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
  return new DavHttpError(
    res.status,
    `HTTP ${res.status}${davError ? ` (${davError})` : ''}`,
    davError,
    retryAfter
  )
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const secs = Number(value)
  if (Number.isFinite(secs)) return Math.min(Math.max(secs, 0), 3600) * 1000
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 3_600_000)
  return null
}

function parseMultistatusResponse(res: DavResponseRaw, requestUrl: string): Multistatus {
  if (res.status !== 207) {
    throw new DavHttpError(res.status, `Unerwarteter Status ${res.status} (207 erwartet)`)
  }
  let root: XmlNode
  try {
    root = parseXml(res.text)
  } catch (error) {
    if (error instanceof XmlParseError)
      throw new DavTransportError(`Ungültiges XML: ${error.message}`)
    throw error
  }
  return parseMultistatus(root, res.url || requestUrl)
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {})
    throw new DavTransportError('Antwort zu groß')
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    let step: ReadableStreamReadResult<Uint8Array>
    try {
      step = await reader.read()
    } catch (error) {
      throw new DavTransportError(describeFetchError(error))
    }
    if (step.done) break
    total += step.value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new DavTransportError('Antwort zu groß')
    }
    chunks.push(step.value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

function describeFetchError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'Zeitüberschreitung'
    const cause = (error as { cause?: { code?: string; message?: string } }).cause
    const detail = cause?.code ?? cause?.message
    return detail ? `Netzwerkfehler (${detail})` : `Netzwerkfehler (${error.message})`
  }
  return 'Netzwerkfehler'
}
