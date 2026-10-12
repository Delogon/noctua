/**
 * Kleiner, robuster vCard-Parser (RFC 6350 / vCard 4.0, RFC 2426 / 3.0, tolerant
 * gegenüber 2.1). Bewusst selbst geschrieben: gebraucht werden nur Namen,
 * Organisation, E-Mail und Telefon; so gibt es keine Abhängigkeit, die Fotos
 * dekodieren oder URLs auflösen könnte. PHOTO/LOGO/SOUND/KEY werden nie
 * gelesen, nie gespeichert und nie nachgeladen — die Zeilen fallen komplett weg.
 */

export interface VCardValue {
  value: string
  /** Erster aussagekräftiger TYPE (home, work, cell …), kleingeschrieben */
  type: string | null
  pref: boolean
}

export interface ParsedVCard {
  version: string | null
  uid: string | null
  fullName: string
  givenName: string | null
  familyName: string | null
  org: string | null
  emails: VCardValue[]
  phones: VCardValue[]
}

const MAX_CARD_CHARS = 256 * 1024
const MAX_VALUES = 20
const MAX_VALUE_LEN = 500
/** Properties, die nie gespeichert werden (Binärdaten/Schlüssel/Fremd-URLs) */
const DROPPED = new Set(['PHOTO', 'LOGO', 'SOUND', 'KEY'])
const NO_SEP = '\u0000'

interface Line {
  name: string
  params: Map<string, string[]>
  value: string
}

/** Zeilenfaltung auflösen (CRLF/LF + Leerzeichen/Tab) und QP-Soft-Breaks (vCard 2.1). */
export function unfold(text: string): string[] {
  const raw = text
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
  const out: string[] = []
  for (let i = 0; i < raw.length; i++) {
    let line = raw[i]
    if (/QUOTED-PRINTABLE/i.test(line.split(':')[0] ?? '')) {
      while (line.endsWith('=') && i + 1 < raw.length) {
        line = line.slice(0, -1) + raw[++i]
      }
    }
    out.push(line)
  }
  return out
}

/** Index des ersten Zeichens `ch` außerhalb von Anführungszeichen. */
function indexOutsideQuotes(s: string, ch: string, from = 0): number {
  let quoted = false
  for (let i = from; i < s.length; i++) {
    const c = s[i]
    if (c === '"') quoted = !quoted
    else if (c === ch && !quoted) return i
  }
  return -1
}

function splitOutsideQuotes(s: string, ch: string): string[] {
  const parts: string[] = []
  let start = 0
  for (;;) {
    const idx = indexOutsideQuotes(s, ch, start)
    if (idx === -1) {
      parts.push(s.slice(start))
      return parts
    }
    parts.push(s.slice(start, idx))
    start = idx + 1
  }
}

/** Property-Name ohne Gruppenpräfix (item1.EMAIL → EMAIL), großgeschrieben. */
function propertyName(head: string): string {
  const name = head.split(';')[0]
  return name
    .slice(name.lastIndexOf('.') + 1)
    .trim()
    .toUpperCase()
}

function parseLine(line: string): Line | null {
  const colon = indexOutsideQuotes(line, ':')
  if (colon <= 0) return null
  const head = splitOutsideQuotes(line.slice(0, colon), ';')
  const name = propertyName(head[0])
  if (!name) return null
  const params = new Map<string, string[]>()
  for (const p of head.slice(1)) {
    const eq = p.indexOf('=')
    // vCard 2.1: nacktes Token (WORK, PREF, QUOTED-PRINTABLE) steht für TYPE=… bzw. ENCODING=…
    if (eq === -1) {
      const token = p.trim().toUpperCase()
      if (/^(QUOTED-PRINTABLE|BASE64|8BIT|7BIT)$/.test(token)) params.set('ENCODING', [token])
      else params.set('TYPE', [...(params.get('TYPE') ?? []), token])
      continue
    }
    const key = p.slice(0, eq).trim().toUpperCase()
    const values = splitOutsideQuotes(p.slice(eq + 1), ',').map((v) =>
      v.trim().replace(/^"|"$/g, '')
    )
    // TYPE="voice,work" (vCard 4.0) darf auch gequotet mehrere Werte tragen
    const flat = key === 'TYPE' ? values.flatMap((v) => v.split(',').map((x) => x.trim())) : values
    params.set(key, [...(params.get(key) ?? []), ...flat])
  }
  return { name, params, value: line.slice(colon + 1) }
}

function decodeQuotedPrintable(value: string, charset: string | undefined): string {
  const bytes: number[] = []
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '=' && /^[0-9A-Fa-f]{2}$/.test(value.slice(i + 1, i + 3))) {
      bytes.push(parseInt(value.slice(i + 1, i + 3), 16))
      i += 2
    } else {
      for (const b of Buffer.from(c, 'utf8')) bytes.push(b)
    }
  }
  try {
    return new TextDecoder(charset ?? 'utf-8').decode(Uint8Array.from(bytes))
  } catch {
    return Buffer.from(bytes).toString('utf8')
  }
}

/** Rohwert → Textliste: an unmaskierten `sep` trennen, dann \\ \, \; \n auflösen. */
function splitEscaped(value: string, sep: string): string[] {
  const parts: string[] = []
  let cur = ''
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '\\' && i + 1 < value.length) {
      const n = value[i + 1]
      cur += n === 'n' || n === 'N' ? '\n' : n
      i++
    } else if (c === sep) {
      parts.push(cur)
      cur = ''
    } else {
      cur += c
    }
  }
  parts.push(cur)
  return parts
}

function lineValue(line: Line): string {
  if (line.params.get('ENCODING')?.[0] === 'QUOTED-PRINTABLE') {
    return decodeQuotedPrintable(line.value, line.params.get('CHARSET')?.[0])
  }
  return line.value
}

function typeOf(line: Line): { type: string | null; pref: boolean } {
  const types = (line.params.get('TYPE') ?? []).map((t) => t.toLowerCase())
  let pref = types.includes('pref')
  const prefParam = line.params.get('PREF')?.[0]
  // vCard 4.0: PREF=1 ist die höchste Präferenz
  if (prefParam === '1') pref = true
  const type = types.find((t) => !['pref', 'internet', 'voice', 'x-inet'].includes(t)) ?? null
  return { type, pref }
}

function clip(value: string): string {
  const v = value.trim()
  return v.length > MAX_VALUE_LEN ? v.slice(0, MAX_VALUE_LEN) : v
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/

/** E-Mail kanonisieren (mailto:-Präfix, Spitzklammern, Kleinschreibung); null = ungültig. */
export function normalizeEmail(raw: string): string | null {
  let v = raw.trim().replace(/^mailto:/i, '')
  const angle = /<([^<>]+)>/.exec(v)
  if (angle) v = angle[1]
  v = v.trim().toLowerCase()
  return EMAIL_RE.test(v) && v.length <= 320 ? v : null
}

function buildCard(lines: Line[]): ParsedVCard | null {
  const card: ParsedVCard = {
    version: null,
    uid: null,
    fullName: '',
    givenName: null,
    familyName: null,
    org: null,
    emails: [],
    phones: []
  }
  let fn = ''
  let composed = ''
  for (const line of lines) {
    if (DROPPED.has(line.name)) continue
    const value = lineValue(line)
    switch (line.name) {
      case 'VERSION':
        card.version = value.trim()
        break
      case 'UID':
        card.uid = clip(splitEscaped(value, NO_SEP)[0]).replace(/^urn:uuid:/i, '') || null
        break
      case 'FN':
        if (!fn) fn = clip(splitEscaped(value, NO_SEP)[0])
        break
      case 'N': {
        const [family = '', given = '', additional = '', prefix = ''] = splitEscaped(value, ';')
        card.familyName = clip(family) || null
        card.givenName = clip(given) || null
        composed = [prefix, given, additional, family].map(clip).filter(Boolean).join(' ')
        break
      }
      case 'ORG':
        if (card.org === null) card.org = clip(splitEscaped(value, ';')[0]) || null
        break
      case 'EMAIL': {
        if (card.emails.length >= MAX_VALUES) break
        const email = normalizeEmail(splitEscaped(value, NO_SEP)[0])
        if (!email || card.emails.some((e) => e.value === email)) break
        const { type, pref } = typeOf(line)
        card.emails.push({ value: email, type, pref })
        break
      }
      case 'TEL': {
        if (card.phones.length >= MAX_VALUES) break
        const tel = clip(splitEscaped(value, NO_SEP)[0]).replace(/^tel:/i, '')
        if (!tel) break
        const { type, pref } = typeOf(line)
        card.phones.push({ value: tel, type, pref })
        break
      }
      default:
    }
  }
  card.fullName = fn || composed || card.org || ''
  if (!card.fullName && card.emails.length > 0) card.fullName = card.emails[0].value
  if (!card.fullName && card.phones.length === 0) return null
  return card
}

/** Alle VCARD-Objekte eines Textes (CardDAV liefert je Ressource eines). */
export function parseVCards(text: string): ParsedVCard[] {
  if (text.length > MAX_CARD_CHARS * 4) return []
  const out: ParsedVCard[] = []
  let current: Line[] | null = null
  for (const rawLine of unfold(text)) {
    const trimmed = rawLine.trim()
    if (/^BEGIN:VCARD$/i.test(trimmed)) {
      current = []
      continue
    }
    if (/^END:VCARD$/i.test(trimmed)) {
      if (current) {
        const card = buildCard(current)
        if (card) out.push(card)
      }
      current = null
      continue
    }
    if (!current || trimmed === '') continue
    const line = parseLine(rawLine)
    if (line) current.push(line)
  }
  return out
}

/** Erste Karte oder null (leer/ungültig/zu groß). */
export function parseVCard(text: string): ParsedVCard | null {
  if (text.length > MAX_CARD_CHARS) return null
  return parseVCards(text)[0] ?? null
}

/** vCard-Text ohne Foto-/Schlüsselzeilen (Fortsetzungszeilen sind vorher entfaltet). */
export function stripBinaryProperties(text: string): string {
  const out: string[] = []
  for (const line of unfold(text)) {
    const colon = indexOutsideQuotes(line, ':')
    if (colon > 0 && DROPPED.has(propertyName(line.slice(0, colon)))) continue
    out.push(line)
  }
  return out.join('\r\n')
}
