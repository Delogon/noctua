import type { FetchLike } from '@main/dav/client'

/**
 * Zustandsbehafteter In-Memory-CalDAV-Server für Sync-Tests: Kalender mit
 * Objekten, ETags, ctag, Änderungsprotokoll für sync-collection, If-Match-
 * Semantik bei PUT/DELETE. Spricht genug WebDAV für die Sync-Engine.
 */

interface FakeObject {
  etag: string
  ics: string
  rev: number
}

interface FakeCalendar {
  name: string
  displayName: string
  objects: Map<string, FakeObject>
  /** href → rev der Löschung */
  tombstones: Map<string, number>
  rev: number
  minValidRev: number
}

export interface FakeCall {
  method: string
  url: string
  headers: Record<string, string>
  body: string
  kind: string
}

export interface FakeServerOptions {
  supportsSync?: boolean
  pageSize?: number
  /** PUT liefert keinen ETag-Header (Server schreibt Inhalt um) */
  noEtagOnPut?: boolean
  /** unterstützte Komponenten der Kalender (Default nur VEVENT) */
  components?: string[]
}

const HOME = '/dav/calendars/anna/'

export class FakeCalDavServer {
  calendars = new Map<string, FakeCalendar>()
  calls: FakeCall[] = []
  options: Required<FakeServerOptions>
  /** Wenn gesetzt: jede Anfrage liefert diesen Status (Auth-/Fehlertests) */
  forceStatus: number | null = null
  /** Wenn gesetzt: PUT/DELETE liefern diesen Status */
  failWrites: number | null = null
  throwNetwork = false
  private etagSeq = 0

  constructor(options: FakeServerOptions = {}) {
    this.options = {
      supportsSync: true,
      pageSize: 0,
      noEtagOnPut: false,
      components: ['VEVENT'],
      ...options
    }
  }

  addCalendar(name: string, displayName = name): void {
    this.calendars.set(name, {
      name,
      displayName,
      objects: new Map(),
      tombstones: new Map(),
      rev: 1,
      minValidRev: 0
    })
  }

  removeCalendar(name: string): void {
    this.calendars.delete(name)
  }

  href(cal: string, file: string): string {
    return `${HOME}${cal}/${file}`
  }

  /** Serverseitige Änderung (z. B. anderer Client). Liefert den neuen ETag. */
  put(cal: string, file: string, ics: string): string {
    const c = this.calendars.get(cal)!
    c.rev += 1
    const etag = `"e${++this.etagSeq}"`
    const href = this.href(cal, file)
    c.objects.set(href, { etag, ics, rev: c.rev })
    c.tombstones.delete(href)
    return etag
  }

  remove(cal: string, file: string): void {
    const c = this.calendars.get(cal)!
    const href = this.href(cal, file)
    c.objects.delete(href)
    c.rev += 1
    c.tombstones.set(href, c.rev)
  }

  /** Macht alle bisherigen Sync-Tokens ungültig. */
  invalidateTokens(cal: string): void {
    const c = this.calendars.get(cal)!
    c.minValidRev = c.rev + 1
    c.rev += 1
  }

  object(cal: string, file: string): FakeObject | undefined {
    return this.calendars.get(cal)?.objects.get(this.href(cal, file))
  }

  callsOfKind(kind: string): FakeCall[] {
    return this.calls.filter((c) => c.kind === kind)
  }

  fetch: FetchLike = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v
    const body = typeof init?.body === 'string' ? init.body : ''
    const call: FakeCall = { method, url: input, headers, body, kind: 'other' }
    this.calls.push(call)
    if (this.throwNetwork) throw new TypeError('fetch failed')
    if (this.forceStatus !== null) {
      call.kind = 'forced'
      return new Response('', { status: this.forceStatus })
    }
    return this.handle(url, method, headers, body, call)
  }

  private xml(inner: string): Response {
    return new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">${inner}</d:multistatus>`,
      { status: 207, headers: { 'content-type': 'application/xml' } }
    )
  }

  private ctag(c: FakeCalendar): string {
    return `ctag-${c.rev}`
  }

  private handle(
    url: URL,
    method: string,
    headers: Record<string, string>,
    body: string,
    call: FakeCall
  ): Response {
    const path = url.pathname
    if (method === 'OPTIONS') {
      call.kind = 'options'
      return new Response('', { status: 200, headers: { dav: '1, calendar-access' } })
    }
    if (method === 'PROPFIND' && path === HOME) {
      call.kind = 'list'
      const items = [...this.calendars.values()]
        .map((c, i) => {
          const reports = this.options.supportsSync
            ? '<d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report></d:supported-report-set>'
            : ''
          return `<d:response><d:href>${HOME}${c.name}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${c.displayName}</d:displayname><a:calendar-order>${i}</a:calendar-order><cs:getctag>${this.ctag(c)}</cs:getctag><d:sync-token>tok-${c.rev}</d:sync-token>${reports}<c:supported-calendar-component-set>${this.options.components.map((n) => `<c:comp name="${n}"/>`).join('')}</c:supported-calendar-component-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
        })
        .join('')
      return this.xml(
        `<d:response><d:href>${HOME}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${items}`
      )
    }

    const m = new RegExp(`^${HOME}([^/]+)/(.*)$`).exec(path)
    const cal = m ? this.calendars.get(m[1]) : undefined
    if (!m || !cal) return new Response('', { status: 404 })
    const file = m[2]

    if (method === 'REPORT') {
      if (body.includes('sync-collection')) {
        call.kind = 'sync-collection'
        return this.syncCollection(cal, body)
      }
      if (body.includes('calendar-multiget')) {
        call.kind = 'multiget'
        const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((x) => x[1])
        const out = hrefs
          .map((h) => {
            const o = cal.objects.get(h)
            return o
              ? `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:getetag>${o.etag}</d:getetag><c:calendar-data><![CDATA[${o.ics}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
              : `<d:response><d:href>${h}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
          })
          .join('')
        return this.xml(out)
      }
      call.kind = 'calendar-query'
      const out = [...cal.objects.entries()]
        .map(
          ([h, o]) =>
            `<d:response><d:href>${h}</d:href><d:propstat><d:prop><d:getetag>${o.etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
        )
        .join('')
      return this.xml(out)
    }

    if (method === 'PROPFIND') {
      call.kind = 'propfind-object'
      const o = cal.objects.get(path)
      return this.xml(
        `<d:response><d:href>${path}</d:href><d:propstat><d:prop><d:getetag>${o?.etag ?? ''}</d:getetag><cs:getctag>${this.ctag(cal)}</cs:getctag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    }

    if (method === 'GET') {
      call.kind = 'get'
      const o = cal.objects.get(path)
      if (!o) return new Response('', { status: 404 })
      return new Response(o.ics, { status: 200, headers: { etag: o.etag } })
    }

    if (method === 'PUT') {
      call.kind = 'put'
      if (this.failWrites !== null) return new Response('', { status: this.failWrites })
      const existing = cal.objects.get(path)
      if (headers['if-none-match'] === '*' && existing) return new Response('', { status: 412 })
      if (headers['if-match'] && (!existing || existing.etag !== headers['if-match'])) {
        return new Response('', { status: 412 })
      }
      const etag = this.put(cal.name, file, body)
      return new Response(null, {
        status: existing ? 204 : 201,
        headers: this.options.noEtagOnPut ? {} : { etag }
      })
    }

    if (method === 'DELETE') {
      call.kind = 'delete'
      if (this.failWrites !== null) return new Response('', { status: this.failWrites })
      const existing = cal.objects.get(path)
      if (!existing) return new Response('', { status: 404 })
      if (headers['if-match'] && existing.etag !== headers['if-match']) {
        return new Response('', { status: 412 })
      }
      this.remove(cal.name, file)
      return new Response(null, { status: 204 })
    }
    return new Response('', { status: 405 })
  }

  private syncCollection(cal: FakeCalendar, body: string): Response {
    const tokenMatch = /<d:sync-token>([^<]*)<\/d:sync-token>/.exec(body)
    const token = tokenMatch?.[1] ?? ''
    let sinceRev = 0
    if (token) {
      const rev = /^tok-(\d+)$/.exec(token)
      sinceRev = rev ? Number(rev[1]) : -1
      if (sinceRev < cal.minValidRev) {
        return new Response('<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>', {
          status: 403,
          headers: { 'content-type': 'application/xml' }
        })
      }
    }
    const changes: Array<{ href: string; rev: number; etag: string | null }> = []
    for (const [href, o] of cal.objects)
      if (o.rev > sinceRev) changes.push({ href, rev: o.rev, etag: o.etag })
    if (token) {
      for (const [href, rev] of cal.tombstones)
        if (rev > sinceRev) changes.push({ href, rev, etag: null })
    }
    changes.sort((a, b) => a.rev - b.rev)
    let truncated = false
    let page = changes
    if (this.options.pageSize > 0 && changes.length > this.options.pageSize) {
      page = changes.slice(0, this.options.pageSize)
      truncated = true
    }
    const newRev = truncated ? page[page.length - 1].rev : cal.rev
    const items = page
      .map((c) =>
        c.etag
          ? `<d:response><d:href>${c.href}</d:href><d:propstat><d:prop><d:getetag>${c.etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
          : `<d:response><d:href>${c.href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
      )
      .join('')
    const trunc = truncated
      ? `<d:response><d:href>${HOME}${cal.name}/</d:href><d:status>HTTP/1.1 507 Insufficient Storage</d:status></d:response>`
      : ''
    return this.xml(`${items}${trunc}<d:sync-token>tok-${newRev}</d:sync-token>`)
  }
}
