import type { MessageDetail } from '@shared/types'

// Recipient computation for replies (M80). Pure function so the rules are
// testable — EmailSheet calls it both for sending and for the
// recipient row above the composer.
//
// Rules:
//  - The reply targets the last foreign message of the thread (fallback:
//    last message, if the thread only contains own ones).
//  - TO = Reply-To header of that message; without Reply-To its From.
//  - ALL: CC = its original To/CC recipients, minus all own
//    addresses (the user can have several accounts), the TO addresses and
//    duplicates (case-insensitive, order is preserved).

export type ReplyScope = 'sender' | 'all'

export type ReplyMessage = Pick<
  MessageDetail,
  'id' | 'fromAddr' | 'to' | 'cc' | 'replyTo' | 'subject'
>

export interface ReplyRecipients {
  to: string[]
  cc: string[]
  subject: string
  replyToMessageId: number
}

function dedupe(addresses: string[], exclude: ReadonlySet<string>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const address of addresses) {
    const key = address.trim().toLowerCase()
    if (!key || exclude.has(key) || seen.has(key)) continue
    seen.add(key)
    result.push(address.trim())
  }
  return result
}

export function buildReplyRecipients(
  messages: ReplyMessage[],
  ownEmails: string[],
  scope: ReplyScope
): ReplyRecipients | null {
  if (messages.length === 0) return null
  const own = new Set(ownEmails.map((e) => e.trim().toLowerCase()).filter(Boolean))
  const last = messages[messages.length - 1]
  const lastForeign =
    [...messages].reverse().find((m) => !own.has((m.fromAddr ?? '').toLowerCase())) ?? last

  const to = dedupe(
    lastForeign.replyTo.length > 0
      ? lastForeign.replyTo.map((r) => r.address)
      : lastForeign.fromAddr
        ? [lastForeign.fromAddr]
        : [],
    new Set()
  )
  // Degenerate case (thread only of own messages): reply to the
  // own address — as before M80.
  if (to.length === 0 && lastForeign.fromAddr) to.push(lastForeign.fromAddr)

  const toKeys = new Set(to.map((a) => a.toLowerCase()))
  const cc =
    scope === 'all'
      ? dedupe(
          [...lastForeign.to, ...lastForeign.cc].map((r) => r.address),
          new Set([...own, ...toKeys])
        )
      : []

  const subject = `Re: ${(lastForeign.subject ?? '').replace(/^(re|aw)\s*:\s*/i, '')}`
  return { to, cc, subject, replyToMessageId: last.id }
}

/**
 * Remove recipients the user struck from the reply row (M97). Answering
 * someone other than the sender means dropping the computed address, not just
 * adding a second one — so the reply can go to a different person entirely.
 * Case-insensitive on the address; the remaining order is untouched.
 */
export function dropRecipients(addresses: string[], dropped: Iterable<string>): string[] {
  const keys = new Set<string>()
  for (const address of dropped) {
    const key = address.trim().toLowerCase()
    if (key) keys.add(key)
  }
  if (keys.size === 0) return addresses
  return addresses.filter((address) => !keys.has(address.trim().toLowerCase()))
}

/**
 * Merge extra recipients (M90: the + button in the reply row) into the
 * computed reply set. Each address ends up in exactly one field — to beats
 * cc beats bcc — and blank entries are dropped.
 */
export function mergeRecipientFields(fields: { to: string[]; cc: string[]; bcc: string[] }): {
  to: string[]
  cc: string[]
  bcc: string[]
} {
  const seen = new Set<string>()
  const takeUnique = (list: string[]): string[] =>
    list.filter((addr) => {
      const key = addr.trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  return { to: takeUnique(fields.to), cc: takeUnique(fields.cc), bcc: takeUnique(fields.bcc) }
}
