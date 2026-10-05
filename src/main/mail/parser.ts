import PostalMime from 'postal-mime'

export interface ParsedAddress {
  name: string | null
  address: string
}

export interface ParsedAttachment {
  filename: string | null
  mimeType: string | null
  contentId: string | null
  size: number
}

/** text/calendar-Teil (Einladung, iMIP): Methode aus dem MIME-Parameter + ICS-Text. */
export interface ParsedCalendarPart {
  method: string | null
  content: string
}

const MAX_CALENDAR_PART_BYTES = 256 * 1024
const MAX_CALENDAR_PARTS = 4

function isCalendarAttachment(att: { mimeType?: string; filename?: string | null }): boolean {
  const type = (att.mimeType ?? '').toLowerCase()
  if (type === 'text/calendar' || type === 'application/ics') return true
  // Manche Clients senden .ics als application/octet-stream
  return /\.ics$/i.test(att.filename ?? '') && (type === '' || type === 'application/octet-stream')
}

export interface ParsedMail {
  messageId: string | null
  inReplyTo: string | null
  references: string[]
  subject: string | null
  from: ParsedAddress | null
  sender?: ParsedAddress | null
  to: ParsedAddress[]
  cc: ParsedAddress[]
  bcc?: ParsedAddress[]
  replyTo: ParsedAddress[]
  date: number | null
  text: string | null
  html: string | null
  snippet: string | null
  attachments: ParsedAttachment[]
  /** Einladungsteile (text/calendar, application/ics) — unvertrauenswürdig, begrenzt */
  calendarParts?: ParsedCalendarPart[]
}

function toAddress(a: { name?: string; address?: string } | undefined): ParsedAddress | null {
  if (!a?.address) return null
  return { name: a.name?.trim() || null, address: a.address.toLowerCase() }
}

function toAddressList(
  list: Array<{ name?: string; address?: string }> | undefined
): ParsedAddress[] {
  return (list ?? []).map(toAddress).filter((a): a is ParsedAddress => a !== null)
}

function parseReferences(raw: string | undefined): string[] {
  if (!raw) return []
  return raw.match(/<[^<>]+>/g) ?? []
}

/** Grober Text-Extrakt aus HTML — nur für Snippets, nicht fürs Rendern. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#\d+;|&\w+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function makeSnippet(text: string | null, html: string | null): string | null {
  const source = text?.trim() || (html ? htmlToText(html) : '')
  if (!source) return null
  return source.replace(/\s+/g, ' ').slice(0, 180)
}

function extractCalendarParts(
  attachments: Array<{
    mimeType?: string
    filename?: string | null
    method?: string
    content?: ArrayBuffer | string | Uint8Array
  }>
): ParsedCalendarPart[] {
  const out: ParsedCalendarPart[] = []
  for (const att of attachments) {
    if (out.length >= MAX_CALENDAR_PARTS) break
    if (!isCalendarAttachment(att) || att.content === undefined) continue
    const size = typeof att.content === 'string' ? att.content.length : att.content.byteLength
    if (size === 0 || size > MAX_CALENDAR_PART_BYTES) continue
    const content =
      typeof att.content === 'string' ? att.content : new TextDecoder('utf-8').decode(att.content)
    if (!/BEGIN:VCALENDAR/i.test(content)) continue
    out.push({ method: att.method?.toUpperCase() ?? null, content })
  }
  return out
}

/** Parst eine rohe RFC822-Mail. Wirft nie — kaputte Mails liefern ein Minimal-Resultat. */
export async function parseMail(source: Buffer | Uint8Array): Promise<ParsedMail> {
  try {
    const email = await PostalMime.parse(source, {
      maxNestingDepth: 64,
      maxHeadersSize: 512 * 1024
    })
    const references = parseReferences(email.headers?.find((h) => h.key === 'references')?.value)
    const text = email.text?.trim() || null
    const html = email.html || null
    return {
      messageId: email.messageId ?? null,
      inReplyTo: email.inReplyTo ?? null,
      references,
      subject: email.subject ?? null,
      from: toAddress(email.from),
      sender: toAddress(email.sender),
      to: toAddressList(email.to),
      cc: toAddressList(email.cc),
      bcc: toAddressList(email.bcc),
      replyTo: toAddressList(email.replyTo),
      date: email.date ? new Date(email.date).getTime() : null,
      text,
      html,
      snippet: makeSnippet(text, html),
      calendarParts: extractCalendarParts(email.attachments ?? []),
      attachments: (email.attachments ?? []).map((att) => ({
        filename: att.filename ?? null,
        mimeType: att.mimeType ?? null,
        contentId: att.contentId?.replace(/[<>]/g, '') ?? null,
        // postal-mime liefert Uint8Array (nicht ArrayBuffer) — sonst stünde überall 0 B
        size:
          typeof att.content === 'string'
            ? att.content.length
            : ((att.content as ArrayBuffer | ArrayBufferView | undefined)?.byteLength ?? 0)
      }))
    }
  } catch (error) {
    console.warn('[parser] failed to parse message:', error)
    return {
      messageId: null,
      inReplyTo: null,
      references: [],
      subject: null,
      from: null,
      sender: null,
      to: [],
      cc: [],
      bcc: [],
      replyTo: [],
      date: null,
      text: '(Parsing fehlgeschlagen)',
      html: null,
      snippet: '(Parsing fehlgeschlagen)',
      attachments: []
    }
  }
}
