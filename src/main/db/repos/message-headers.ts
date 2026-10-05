import type Database from 'better-sqlite3-multiple-ciphers'
import type { MailAuthenticationStatus, MessageHeaderDetails, Recipient } from '@shared/types'

const MAX_RAW_HEADER_BYTES = 512 * 1024
const AUTH_STATUSES = new Set<MailAuthenticationStatus>([
  'pass',
  'fail',
  'softfail',
  'neutral',
  'temperror',
  'permerror',
  'none'
])

export interface FetchedMessageHeaderData {
  from: Recipient[]
  sender: Recipient[]
  to: Recipient[]
  cc: Recipient[]
  bcc: Recipient[]
  replyTo: Recipient[]
  rawHeaders: Buffer
}

interface HeaderField {
  name: string
  value: string
}

interface MessageHeaderRow {
  id: number
  subject: string | null
  from_name: string | null
  from_addr: string | null
  to_json: string | null
  cc_json: string | null
  message_id: string | null
  in_reply_to: string | null
  refs: string | null
  date: number | null
  internal_date: number | null
  size: number | null
  cached_from_json: string | null
  sender_json: string | null
  cached_to_json: string | null
  cached_cc_json: string | null
  bcc_json: string | null
  reply_to_json: string | null
  raw_headers: string | null
  raw_headers_truncated: number | null
}

function parseRecipients(json: string | null): Recipient[] {
  if (!json) return []
  try {
    return (JSON.parse(json) as Array<{ name?: string | null; address?: string }>)
      .filter((recipient) => typeof recipient.address === 'string' && recipient.address.length > 0)
      .map((recipient) => ({
        name: typeof recipient.name === 'string' ? safeInlineText(recipient.name) : null,
        address: safeInlineText(recipient.address!)
      }))
  } catch {
    return []
  }
}

/** Entfernt Steuer- und Richtungszeichen, ohne sichtbare Headerdaten umzudeuten. */
function safeHeaderText(value: string): string {
  return [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      const unsafeControl =
        codePoint <= 0x08 ||
        codePoint === 0x0b ||
        codePoint === 0x0c ||
        (codePoint >= 0x0e && codePoint <= 0x1f) ||
        (codePoint >= 0x7f && codePoint <= 0x9f)
      const unsafeDirectionMark =
        codePoint === 0x061c ||
        (codePoint >= 0x200b && codePoint <= 0x200f) ||
        (codePoint >= 0x202a && codePoint <= 0x202e) ||
        (codePoint >= 0x2060 && codePoint <= 0x2064) ||
        (codePoint >= 0x2066 && codePoint <= 0x206f) ||
        codePoint === 0xfeff
      return unsafeControl || unsafeDirectionMark ? '�' : character
    })
    .join('')
}

function safeInlineText(value: string): string {
  return safeHeaderText(value)
    .replace(/\r?\n[ \t]+/g, ' ')
    .trim()
}

function parseHeaderFields(rawHeaders: string): HeaderField[] {
  const fields: HeaderField[] = []
  for (const line of rawHeaders.split(/\r?\n/)) {
    if (line === '') break
    if (/^[ \t]/.test(line) && fields.length > 0) {
      fields[fields.length - 1].value += ` ${safeInlineText(line)}`
      continue
    }
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const name = safeInlineText(line.slice(0, separator))
    const value = safeInlineText(line.slice(separator + 1))
    if (name) fields.push({ name, value })
  }
  return fields
}

function valuesFor(fields: HeaderField[], name: string): string[] {
  const lower = name.toLowerCase()
  return fields.filter((field) => field.name.toLowerCase() === lower).map((field) => field.value)
}

function authStatus(values: string[], method: string): MailAuthenticationStatus {
  const match = values
    .join('; ')
    .match(new RegExp(`(?:^|[;\\s])${method}=([a-z]+)`, 'i'))?.[1]
    ?.toLowerCase() as MailAuthenticationStatus | undefined
  return match && AUTH_STATUSES.has(match) ? match : 'unknown'
}

function spfStatus(authValues: string[], receivedSpf: string[]): MailAuthenticationStatus {
  const direct = authStatus(authValues, 'spf')
  if (direct !== 'unknown') return direct
  const fallback = receivedSpf[0]?.match(/^\s*([a-z]+)/i)?.[1]?.toLowerCase() as
    MailAuthenticationStatus | undefined
  return fallback && AUTH_STATUSES.has(fallback) ? fallback : 'unknown'
}

function domainFromAddress(value: string | null): string | null {
  if (!value) return null
  const cleaned = value.replace(/[<>]/g, '').trim()
  const at = cleaned.lastIndexOf('@')
  return at >= 0 ? cleaned.slice(at + 1).replace(/[;\s].*$/, '') || null : cleaned || null
}

function parseReferences(raw: string | null): string[] {
  return raw?.match(/<[^<>]+>/g) ?? []
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

export function storeMessageHeaderDetails(
  db: Database.Database,
  messageId: number,
  fetched: FetchedMessageHeaderData
): void {
  const rawHeadersTruncated = fetched.rawHeaders.byteLength > MAX_RAW_HEADER_BYTES
  const rawHeaders = safeHeaderText(
    fetched.rawHeaders.subarray(0, MAX_RAW_HEADER_BYTES).toString('latin1')
  )
  db.prepare(
    `INSERT INTO message_header_details
       (message_id, from_json, sender_json, to_json, cc_json, bcc_json,
        reply_to_json, raw_headers, raw_headers_truncated, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(message_id) DO UPDATE SET
       from_json = excluded.from_json,
       sender_json = excluded.sender_json,
       to_json = excluded.to_json,
       cc_json = excluded.cc_json,
       bcc_json = excluded.bcc_json,
       reply_to_json = excluded.reply_to_json,
       raw_headers = excluded.raw_headers,
       raw_headers_truncated = excluded.raw_headers_truncated,
       fetched_at = excluded.fetched_at`
  ).run(
    messageId,
    JSON.stringify(fetched.from),
    JSON.stringify(fetched.sender),
    JSON.stringify(fetched.to),
    JSON.stringify(fetched.cc),
    JSON.stringify(fetched.bcc),
    JSON.stringify(fetched.replyTo),
    rawHeaders,
    rawHeadersTruncated ? 1 : 0,
    Date.now()
  )
}

export function getMessageHeaderDetails(
  db: Database.Database,
  messageId: number
): MessageHeaderDetails | null {
  const row = db
    .prepare(
      `SELECT m.id, m.subject, m.from_name, m.from_addr, m.to_json, m.cc_json,
              m.message_id, m.in_reply_to, m.refs, m.date, m.internal_date, m.size,
              h.from_json AS cached_from_json, h.sender_json,
              h.to_json AS cached_to_json, h.cc_json AS cached_cc_json,
              h.bcc_json, h.reply_to_json, h.raw_headers, h.raw_headers_truncated
       FROM messages m
       LEFT JOIN message_header_details h ON h.message_id = m.id
       WHERE m.id = ?`
    )
    .get(messageId) as MessageHeaderRow | undefined
  if (!row) return null

  const technicalAvailable = row.raw_headers !== null
  const rawHeaders = row.raw_headers
  const fields = rawHeaders ? parseHeaderFields(rawHeaders) : []
  const authenticationHeaders = fields.filter((field) =>
    ['authentication-results', 'arc-authentication-results'].includes(field.name.toLowerCase())
  )
  // Für die kompakte Ampel nur das oberste gemeldete Ergebnis verwenden.
  // Untere Resultate können aus Weiterleitungen stammen oder selbst Teil der
  // eingegangenen Nachricht sein. Alle Zeilen bleiben im Roh-Header einsehbar.
  const primaryAuthenticationValue = [
    fields.find((field) => field.name.toLowerCase() === 'authentication-results')?.value ??
      fields.find((field) => field.name.toLowerCase() === 'arc-authentication-results')?.value
  ].filter((value): value is string => Boolean(value))
  const receivedSpf = valuesFor(fields, 'received-spf')
  const returnPath = valuesFor(fields, 'return-path')[0] ?? null
  const dkimSignature = valuesFor(fields, 'dkim-signature')[0] ?? ''
  const authText = primaryAuthenticationValue.join('; ')
  const reporterCandidate = primaryAuthenticationValue[0]?.split(';')[0]?.trim() ?? ''
  const reportedBy = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(reporterCandidate)
    ? reporterCandidate
    : null
  const mailedByValue = authText.match(/\bsmtp\.mailfrom=([^;\s]+)/i)?.[1] ?? returnPath
  const signedBy =
    authText.match(/\bheader\.d=([^;\s]+)/i)?.[1] ??
    dkimSignature.match(/(?:^|;)\s*d=([^;\s]+)/i)?.[1] ??
    null
  const spamHeaders = fields.filter((field) =>
    ['x-spam-status', 'x-spam-score', 'x-spam-flag'].includes(field.name.toLowerCase())
  )
  const baseFrom = row.from_addr
    ? [
        {
          name: row.from_name ? safeInlineText(row.from_name) : null,
          address: safeInlineText(row.from_addr)
        }
      ]
    : []
  const authenticationComplete = technicalAvailable && row.raw_headers_truncated !== 1

  return {
    messageId: row.id,
    technicalAvailable,
    from: technicalAvailable ? parseRecipients(row.cached_from_json) : baseFrom,
    sender: parseRecipients(row.sender_json),
    to: technicalAvailable ? parseRecipients(row.cached_to_json) : parseRecipients(row.to_json),
    cc: technicalAvailable ? parseRecipients(row.cached_cc_json) : parseRecipients(row.cc_json),
    bcc: parseRecipients(row.bcc_json),
    replyTo: parseRecipients(row.reply_to_json),
    subject: row.subject ? safeInlineText(row.subject) : null,
    sentAt: row.date,
    receivedAt: row.internal_date,
    size: row.size,
    messageIdHeader: row.message_id ? safeInlineText(row.message_id) : null,
    inReplyTo: row.in_reply_to ? safeInlineText(row.in_reply_to) : null,
    references: parseReferences(row.refs).map(safeInlineText),
    returnPath,
    deliveredTo: unique([
      ...valuesFor(fields, 'delivered-to'),
      ...valuesFor(fields, 'x-original-to')
    ]),
    authentication: {
      spf: authenticationComplete ? spfStatus(primaryAuthenticationValue, receivedSpf) : 'unknown',
      dkim: authenticationComplete ? authStatus(primaryAuthenticationValue, 'dkim') : 'unknown',
      dmarc: authenticationComplete ? authStatus(primaryAuthenticationValue, 'dmarc') : 'unknown',
      mailedBy: domainFromAddress(mailedByValue),
      signedBy: signedBy ? safeInlineText(signedBy) : null,
      reportedBy,
      headers: authenticationHeaders
    },
    received: valuesFor(fields, 'received'),
    spamHeaders,
    rawHeaders,
    rawHeadersTruncated: row.raw_headers_truncated === 1
  }
}
