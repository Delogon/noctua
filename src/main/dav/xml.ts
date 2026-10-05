/**
 * Minimaler, namespace-bewusster XML-Parser für WebDAV-Antworten (Multistatus,
 * Propfind, CalDAV-Reports). Bewusst selbst geschrieben statt einer
 * XML-Bibliothek: WebDAV-XML ist ein kleiner Ausschnitt (Elemente, Attribute,
 * Text, CDATA), und so gibt es keine Angriffsfläche durch DTDs oder externe
 * Entities (XXE / Billion Laughs): `<!DOCTYPE` wird abgelehnt, `<!ENTITY` gibt
 * es damit nicht, und es werden nur die fünf vordefinierten sowie numerische
 * Zeichenreferenzen aufgelöst. Tiefe und Knotenzahl sind begrenzt.
 */

export interface XmlNode {
  /** Namespace-URI ('' = keiner) */
  ns: string
  /** Lokaler Name ohne Präfix */
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  /** Zusammengeführter direkter Textinhalt (inkl. CDATA) */
  text: string
}

export class XmlParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XmlParseError'
  }
}

const MAX_DEPTH = 48
const MAX_NODES = 200_000

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(raw: string): string {
  if (!raw.includes('&')) return raw
  return raw.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x')) return safeCodePoint(parseInt(body.slice(2), 16), match)
    if (body.startsWith('#')) return safeCodePoint(parseInt(body.slice(1), 10), match)
    return PREDEFINED[body] ?? match
  })
}

function safeCodePoint(code: number, fallback: string): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
    return fallback
  }
  return String.fromCodePoint(code)
}

interface OpenElement {
  prefix: string
  local: string
  node: XmlNode
  /** Namespace-Bindungen dieses Elements (Präfix → URI) */
  scope: Map<string, string>
}

const NAME_CHAR = /[^\s/>=]/
const SPACE = /\s/

/** Parst ein XML-Dokument und liefert das Wurzelelement. */
export function parseXml(input: string): XmlNode {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  let pos = 0
  let nodeCount = 0
  const stack: OpenElement[] = []
  let root: XmlNode | null = null

  const lookupNs = (prefix: string): string => {
    for (let i = stack.length - 1; i >= 0; i--) {
      const uri = stack[i].scope.get(prefix)
      if (uri !== undefined) return uri
    }
    if (prefix === 'xml') return 'http://www.w3.org/XML/1998/namespace'
    return ''
  }

  while (pos < src.length) {
    const lt = src.indexOf('<', pos)
    if (lt === -1) {
      if (stack.length > 0) throw new XmlParseError('Unerwartetes Dokumentende')
      break
    }
    if (lt > pos && stack.length > 0) {
      stack[stack.length - 1].node.text += decodeEntities(src.slice(pos, lt))
    }
    pos = lt

    if (src.startsWith('<!--', pos)) {
      const end = src.indexOf('-->', pos + 4)
      if (end === -1) throw new XmlParseError('Kommentar nicht geschlossen')
      pos = end + 3
      continue
    }
    if (src.startsWith('<![CDATA[', pos)) {
      const end = src.indexOf(']]>', pos + 9)
      if (end === -1) throw new XmlParseError('CDATA nicht geschlossen')
      if (stack.length > 0) stack[stack.length - 1].node.text += src.slice(pos + 9, end)
      pos = end + 3
      continue
    }
    if (src.startsWith('<?', pos)) {
      const end = src.indexOf('?>', pos + 2)
      if (end === -1) throw new XmlParseError('Processing Instruction nicht geschlossen')
      pos = end + 2
      continue
    }
    if (src.startsWith('<!', pos)) {
      // DOCTYPE/ENTITY: nie verarbeiten (XXE, Entity-Expansion)
      throw new XmlParseError('DTD/DOCTYPE nicht erlaubt')
    }

    if (src[pos + 1] === '/') {
      const end = src.indexOf('>', pos)
      if (end === -1) throw new XmlParseError('Schließendes Tag unvollständig')
      const raw = src.slice(pos + 2, end).trim()
      const open = stack.pop()
      if (!open) throw new XmlParseError('Unerwartetes schließendes Tag')
      const expected = open.prefix ? `${open.prefix}:${open.local}` : open.local
      if (raw !== expected) throw new XmlParseError(`Tag-Mismatch: ${raw} ≠ ${expected}`)
      pos = end + 1
      if (stack.length === 0) {
        root = open.node
        // Nur noch Whitespace/Kommentare dürfen folgen
        if (
          src
            .slice(pos)
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim() !== ''
        ) {
          throw new XmlParseError('Inhalt nach dem Wurzelelement')
        }
        break
      }
      continue
    }

    // Start-Tag
    let i = pos + 1
    while (i < src.length && NAME_CHAR.test(src[i])) i++
    const qname = src.slice(pos + 1, i)
    if (!qname) throw new XmlParseError('Leerer Tag-Name')
    const rawAttrs: Array<[string, string]> = []
    let selfClose = false
    for (;;) {
      while (i < src.length && SPACE.test(src[i])) i++
      if (i >= src.length) throw new XmlParseError('Start-Tag nicht geschlossen')
      if (src[i] === '>') {
        i++
        break
      }
      if (src[i] === '/' && src[i + 1] === '>') {
        selfClose = true
        i += 2
        break
      }
      let j = i
      while (j < src.length && NAME_CHAR.test(src[j])) j++
      const attrName = src.slice(i, j)
      if (!attrName) throw new XmlParseError('Ungültiges Attribut')
      i = j
      while (i < src.length && SPACE.test(src[i])) i++
      if (src[i] !== '=') throw new XmlParseError('Attribut ohne Wert')
      i++
      while (i < src.length && SPACE.test(src[i])) i++
      const quote = src[i]
      if (quote !== '"' && quote !== "'") {
        throw new XmlParseError('Attributwert ohne Anführungszeichen')
      }
      const endQuote = src.indexOf(quote, i + 1)
      if (endQuote === -1) throw new XmlParseError('Attributwert nicht geschlossen')
      rawAttrs.push([attrName, decodeEntities(src.slice(i + 1, endQuote))])
      i = endQuote + 1
    }

    nodeCount += 1
    if (nodeCount > MAX_NODES) throw new XmlParseError('Zu viele XML-Knoten')
    if (stack.length >= MAX_DEPTH) throw new XmlParseError('XML zu tief verschachtelt')

    const colon = qname.indexOf(':')
    const prefix = colon === -1 ? '' : qname.slice(0, colon)
    const local = colon === -1 ? qname : qname.slice(colon + 1)
    const scope = new Map<string, string>()
    for (const [k, v] of rawAttrs) {
      if (k === 'xmlns') scope.set('', v)
      else if (k.startsWith('xmlns:')) scope.set(k.slice(6), v)
    }
    const element: OpenElement = {
      prefix,
      local,
      scope,
      node: { ns: '', name: local, attrs: {}, children: [], text: '' }
    }
    stack.push(element)
    element.node.ns = lookupNs(prefix)
    for (const [k, v] of rawAttrs) {
      if (k === 'xmlns' || k.startsWith('xmlns:')) continue
      const c = k.indexOf(':')
      element.node.attrs[c === -1 ? k : k.slice(c + 1)] = v
    }
    if (stack.length > 1) stack[stack.length - 2].node.children.push(element.node)

    pos = i
    if (selfClose) {
      stack.pop()
      if (stack.length === 0) {
        root = element.node
        if (
          src
            .slice(pos)
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim() !== ''
        ) {
          throw new XmlParseError('Inhalt nach dem Wurzelelement')
        }
        break
      }
    }
  }

  if (!root) throw new XmlParseError('Kein Wurzelelement')
  return root
}

// --- Navigations-Helfer --------------------------------------------------------

export const NS = {
  dav: 'DAV:',
  caldav: 'urn:ietf:params:xml:ns:caldav',
  carddav: 'urn:ietf:params:xml:ns:carddav',
  cs: 'http://calendarserver.org/ns/',
  apple: 'http://apple.com/ns/ical/',
  oc: 'http://owncloud.org/ns',
  nc: 'http://nextcloud.org/ns'
} as const

export function child(node: XmlNode | undefined, ns: string, name: string): XmlNode | undefined {
  return node?.children.find((c) => c.ns === ns && c.name === name)
}

export function children(node: XmlNode | undefined, ns: string, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.ns === ns && c.name === name) : []
}

export function textOf(node: XmlNode | undefined): string | null {
  if (!node) return null
  const t = node.text.trim()
  return t === '' ? null : t
}

// --- Serialisierung (Request-Bodies) -------------------------------------------

/** Escaped Text für XML-Inhalte und Attributwerte. */
export function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
}
