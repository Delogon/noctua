export interface AttachmentVisibilityInput {
  mimeType: string | null
  filename?: string | null
  contentId: string | null
}

const TECHNICAL_MIME_PARTS = new Set([
  'text/x-amp-html',
  'application/pgp-signature',
  'application/pkcs7-signature',
  'application/x-pkcs7-signature'
])

function normalizedContentId(value: string | null): string {
  return (value ?? '').replace(/[<>]/g, '').trim().toLowerCase()
}

/**
 * Inline CID images already appear in the mail text, and technical MIME parts
 * are not files that senders attached. Content-ID
 * alone is not enough: some real attachments have one as well.
 */
export function isVisibleMailAttachment(
  attachment: AttachmentVisibilityInput,
  html: string | null
): boolean {
  const mimeType = (attachment.mimeType ?? '').trim().toLowerCase()
  if (TECHNICAL_MIME_PARTS.has(mimeType)) return false
  // Nameless text/calendar part = alternative to the mail text, shown by the invitation card;
  // a named .ics file stays visible as an attachment.
  if (mimeType === 'text/calendar' && !(attachment.filename ?? '').trim()) return false

  const contentId = normalizedContentId(attachment.contentId)
  if (!mimeType.startsWith('image/') || !contentId || !html) return true

  return !html.toLowerCase().includes(`cid:${contentId}`)
}
