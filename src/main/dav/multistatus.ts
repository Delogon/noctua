import { child, children, textOf, NS, type XmlNode } from './xml'
import { normalizeHref } from './url'

/** Geparster 207-Multistatus (RFC 4918 §13) inkl. sync-token (RFC 6578). */

export interface DavPropstat {
  status: number
  /** Kinder des <prop>-Elements */
  props: XmlNode[]
}

export interface DavResponse {
  /** Normalisierter Pfad (siehe normalizeHref) */
  href: string
  /** Absolute URL (Origin der Antwort bzw. des absoluten Hrefs + normalisierter Pfad) */
  url: string
  /** Status auf Response-Ebene (z. B. 404 für gelöschte Member in sync-collection) */
  status: number | null
  propstats: DavPropstat[]
  /** DAV:error-Inhalt auf Response-Ebene */
  error: string | null
}

export interface Multistatus {
  responses: DavResponse[]
  syncToken: string | null
  /** URL, gegen die relative Hrefs aufgelöst wurden (finale URL nach Redirects) */
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

/** Erstes erfolgreich (2xx) geliefertes Property-Element. */
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

/** href-Kind eines Properties → absolute, normalisierte URL (Origin bleibt erhalten). */
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

/** href-Kind eines Properties (z. B. current-user-principal) → normalisierter Pfad. */
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

/** Menge von Kindelement-Namen (z. B. resourcetype → {collection, calendar}). */
export function childNames(node: XmlNode | undefined): Set<string> {
  return new Set((node?.children ?? []).map((c) => c.name))
}
