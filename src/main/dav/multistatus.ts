import { child, children, textOf, NS, type XmlNode } from './xml'
import { normalizeHref } from './url'

/** Parsed 207 multistatus (RFC 4918 §13) incl. sync-token (RFC 6578). */

export interface DavPropstat {
  status: number
  /** Children of the <prop> element */
  props: XmlNode[]
}

export interface DavResponse {
  /** Normalized path (see normalizeHref) */
  href: string
  /** Absolute URL (origin of the response or of the absolute href + normalized path) */
  url: string
  /** Status at response level (e.g. 404 for deleted members in sync-collection) */
  status: number | null
  propstats: DavPropstat[]
  /** DAV:error content at response level */
  error: string | null
}

export interface Multistatus {
  responses: DavResponse[]
  syncToken: string | null
  /** URL against which relative hrefs were resolved (final URL after redirects) */
  baseUrl: string
}

export function parseStatusLine(line: string | null): number | null {
  if (!line) return null
  const m = /\s(\d{3})(?:\s|$)/.exec(line)
  return m ? Number(m[1]) : null
}

export function parseMultistatus(root: XmlNode, baseUrl: string): Multistatus {
  if (root.ns !== NS.dav || root.name !== 'multistatus') {
    throw new Error('Kein DAV:multistatus')
  }
  const responses: DavResponse[] = []
  for (const r of children(root, NS.dav, 'response')) {
    const hrefNode = child(r, NS.dav, 'href')
    const rawHref = textOf(hrefNode)
    if (!rawHref) continue
    let href: string
    let url: string
    try {
      href = normalizeHref(rawHref, baseUrl)
      url = new URL(href, new URL(rawHref, baseUrl)).toString()
    } catch {
      continue
    }
    const propstats: DavPropstat[] = children(r, NS.dav, 'propstat').map((ps) => ({
      status: parseStatusLine(textOf(child(ps, NS.dav, 'status'))) ?? 200,
      props: child(ps, NS.dav, 'prop')?.children ?? []
    }))
    const errNode = child(r, NS.dav, 'error')
    responses.push({
      href,
      url,
      status: parseStatusLine(textOf(child(r, NS.dav, 'status'))),
      propstats,
      error: errNode?.children[0]?.name ?? null
    })
  }
  return { responses, syncToken: textOf(child(root, NS.dav, 'sync-token')), baseUrl }
}

/** First property element delivered successfully (2xx). */
export function okProp(response: DavResponse, ns: string, name: string): XmlNode | undefined {
  for (const ps of response.propstats) {
    if (ps.status < 200 || ps.status >= 300) continue
    const found = ps.props.find((p) => p.ns === ns && p.name === name)
    if (found) return found
  }
  return undefined
}

export function okPropText(response: DavResponse, ns: string, name: string): string | null {
  return textOf(okProp(response, ns, name))
}

/** href child of a property → absolute, normalized URL (the origin is preserved). */
export function okPropUrl(
  response: DavResponse,
  ns: string,
  name: string,
  baseUrl: string
): string | null {
  const href = textOf(child(okProp(response, ns, name), NS.dav, 'href'))
  if (!href) return null
  try {
    const abs = new URL(href, baseUrl)
    return new URL(normalizeHref(href, baseUrl), abs).toString()
  } catch {
    return null
  }
}

/** href child of a property (e.g. current-user-principal) → normalized path. */
export function okPropHref(
  response: DavResponse,
  ns: string,
  name: string,
  baseUrl: string
): string | null {
  const href = textOf(child(okProp(response, ns, name), NS.dav, 'href'))
  if (!href) return null
  try {
    return normalizeHref(href, baseUrl)
  } catch {
    return null
  }
}

/** Set of child element names (e.g. resourcetype → {collection, calendar}). */
export function childNames(node: XmlNode | undefined): Set<string> {
  return new Set((node?.children ?? []).map((c) => c.name))
}
