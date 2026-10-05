import type { FetchLike } from '@main/dav/client'

/**
 * Zustandsbehafteter In-Memory-CardDAV-Server für Sync-Tests: Principal mit
 * addressbook-home-set, Adressbücher mit Karten, ETags, ctag und
 * Änderungsprotokoll für sync-collection.
 */

interface FakeCard {
  etag: string
  vcard: string
  rev: number
}

interface FakeBook {
  name: string
  displayName: string
  cards: Map<string, FakeCard>
  tombstones: Map<string, number>
  rev: number
}

export const PRINCIPAL = '/dav/principals/users/anna/'
export const HOME = '/dav/addressbooks/users/anna/'

export class FakeCardDavServer {
  books = new Map<string, FakeBook>()
  calls: Array<{ method: string; url: string; body: string; kind: string }> = []
  supportsSync = true
  forceStatus: number | null = null
  private etagSeq = 0

  addBook(name: string, displayName = name): void {
    this.books.set(name, {
      name,
      displayName,
      cards: new Map(),
      tombstones: new Map(),
      rev: 1
    })
  }

  href(book: string, file: string): string {
    return `${HOME}${book}/${file}`
  }

  put(book: string, file: string, vcard: string): void {
    const b = this.books.get(book)!
    b.rev += 1
    b.cards.set(this.href(book, file), { etag: `"c${++this.etagSeq}"`, vcard, rev: b.rev })
    b.tombstones.delete(this.href(book, file))
  }

  remove(book: string, file: string): void {
    const b = this.books.get(book)!
    b.cards.delete(this.href(book, file))
    b.rev += 1
    b.tombstones.set(this.href(book, file), b.rev)
  }

  callsOfKind(kind: string): Array<{ method: string; url: string; body: string; kind: string }> {
    return this.calls.filter((c) => c.kind === kind)
  }

  private xml(inner: string): Response {
    return new Response(
      `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav" xmlns:cs="http://calendarserver.org/ns/">${inner}</d:multistatus>`,
      { status: 207, headers: { 'content-type': 'application/xml' } }
    )
  }

  private cardResponse(href: string, card: FakeCard, withData: boolean): string {
    const data = withData ? `<card:address-data><![CDATA[${card.vcard}]]></card:address-data>` : ''
    return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${card.etag}</d:getetag>${data}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
  }

  fetch: FetchLike = async (input, init) => {
    const url = new URL(input)
    const method = init?.method ?? 'GET'
    const body = typeof init?.body === 'string' ? init.body : ''
    const call = { method, url: input, body, kind: 'other' }
    this.calls.push(call)
    if (this.forceStatus !== null) return new Response('', { status: this.forceStatus })
    const path = url.pathname

    if (method === 'PROPFIND' && path === PRINCIPAL) {
      call.kind = 'principal'
      return this.xml(
        `<d:response><d:href>${PRINCIPAL}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><d:principal/></d:resourcetype><d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal><card:addressbook-home-set><d:href>${HOME}</d:href></card:addressbook-home-set></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
      )
    }
    if (method === 'PROPFIND' && path === HOME) {
      call.kind = 'list'
      const reports = this.supportsSync
        ? '<d:supported-report-set><d:supported-report><d:report><d:sync-collection/></d:report></d:supported-report></d:supported-report-set>'
        : ''
      const items = [...this.books.values()]
        .map(
          (b) =>
            `<d:response><d:href>${HOME}${b.name}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/><card:addressbook/></d:resourcetype><d:displayname>${b.displayName}</d:displayname><cs:getctag>ctag-${b.rev}</cs:getctag><d:sync-token>tok-${b.rev}</d:sync-token>${reports}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
        )
        .join('')
      return this.xml(
        `<d:response><d:href>${HOME}</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>${items}`
      )
    }

    const m = new RegExp(`^${HOME}([^/]+)/$`).exec(path)
    const book = m ? this.books.get(m[1]) : undefined
    if (!book) return new Response('', { status: 404 })

    if (method === 'REPORT' && body.includes('sync-collection')) {
      call.kind = 'sync-collection'
      if (!this.supportsSync) return new Response('', { status: 501 })
      const token = /<d:sync-token>([^<]*)<\/d:sync-token>/.exec(body)?.[1] ?? ''
      const since = token ? Number(/^tok-(\d+)$/.exec(token)?.[1] ?? -1) : 0
      if (since < 0) {
        return new Response('<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>', {
          status: 403,
          headers: { 'content-type': 'application/xml' }
        })
      }
      let items = ''
      for (const [href, c] of book.cards)
        if (c.rev > since) items += this.cardResponse(href, c, false)
      if (token) {
        for (const [href, rev] of book.tombstones) {
          if (rev > since)
            items += `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
        }
      }
      return this.xml(`${items}<d:sync-token>tok-${book.rev}</d:sync-token>`)
    }
    if (method === 'REPORT' && body.includes('addressbook-multiget')) {
      call.kind = 'multiget'
      const hrefs = [...body.matchAll(/<d:href>([^<]+)<\/d:href>/g)].map((x) => x[1])
      return this.xml(
        hrefs
          .map((h) => {
            const c = book.cards.get(h)
            return c
              ? this.cardResponse(h, c, true)
              : `<d:response><d:href>${h}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
          })
          .join('')
      )
    }
    if (method === 'PROPFIND') {
      call.kind = 'etags'
      return this.xml(
        `<d:response><d:href>${HOME}${book.name}/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>` +
          [...book.cards].map(([h, c]) => this.cardResponse(h, c, false)).join('')
      )
    }
    return new Response('', { status: 405 })
  }
}
