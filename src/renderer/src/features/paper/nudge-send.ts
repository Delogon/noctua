// Pure logic of nudge sending (Waiting view) — separate from the
// WaitingSheet component so it stays testable under Node/Vitest.

/** A nudge counts for the calendar day — from midnight on, nudging is allowed again. */
export function nudgedToday(nudgedAt: number | null, now = Date.now()): boolean {
  if (!nudgedAt) return false
  const a = new Date(nudgedAt)
  const b = new Date(now)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

export interface NudgeSendPayload {
  accountId: number
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  textBody: string
  htmlBody: string
  replyToMessageId: number
}

/**
 * Builds the compose:send payload for a nudge. The signature is deliberately
 * NOT appended: the send path (sendMail/appendSignatureText) adds the
 * account signature exactly once — exactly the same way as for replies.
 * replyToMessageId points to our own sent mail so the nudge lands in the
 * right thread at the recipient (In-Reply-To/References).
 */
export function buildNudgeSend(
  followup: { messageId: number; accountId: number; subject: string | null; toAddrs: string[] },
  text: string,
  htmlBody: string
): NudgeSendPayload {
  return {
    accountId: followup.accountId,
    to: followup.toAddrs,
    cc: [],
    bcc: [],
    subject: `Re: ${(followup.subject ?? '').replace(/^(re|aw)\s*:\s*/i, '')}`,
    textBody: text.trimEnd(),
    htmlBody,
    replyToMessageId: followup.messageId
  }
}
