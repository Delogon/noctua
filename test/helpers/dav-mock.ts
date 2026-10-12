import type { FetchLike } from '@main/dav/client'

export interface MockRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

export interface MockReply {
  status?: number
  headers?: Record<string, string>
  body?: string
}

export type MockHandler = (
  req: MockRequest
) => MockReply | undefined | Promise<MockReply | undefined>

/** Fetch-Mock für DAV-Tests: protokolliert Requests, Handler antwortet je Anfrage. */
export function createMockFetch(handler: MockHandler): { fetch: FetchLike; calls: MockRequest[] } {
  const calls: MockRequest[] = []
  const fetchImpl: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {}
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v
    const req: MockRequest = {
      method: init?.method ?? 'GET',
      url: input,
      headers,
      body: typeof init?.body === 'string' ? init.body : ''
    }
    calls.push(req)
    const reply = (await handler(req)) ?? { status: 404 }
    return new Response(reply.body ?? '', {
      status: reply.status ?? 200,
      headers: reply.headers
    })
  }
  return { fetch: fetchImpl, calls }
}

export const XML_CT = { 'Content-Type': 'application/xml; charset=utf-8' }

export function multistatus(inner: string, extra = ''): MockReply {
  return {
    status: 207,
    headers: XML_CT,
    body: `<?xml version="1.0" encoding="utf-8"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/" xmlns:oc="http://owncloud.org/ns">${inner}${extra}</d:multistatus>`
  }
}

export function respEtag(href: string, etag: string): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
}

export function respData(href: string, etag: string, ics: string): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:getetag>${etag}</d:getetag><c:calendar-data><![CDATA[${ics}]]></c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`
}

export function respGone(href: string): string {
  return `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
}
