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
 * Inline-CID-Bilder erscheinen bereits im Mailtext und technische MIME-Teile
 * sind keine Dateien, die Empfaenger als Anhang abgelegt haben. Content-ID
 * allein reicht nicht: Manche echten Anhaenge besitzen ebenfalls eine.
 */
export function isVisibleMailAttachment(
  attachment: AttachmentVisibilityInput,
  html: string | null
): boolean {
  const mimeType = (attachment.mimeType ?? '').trim().toLowerCase()
  if (TECHNICAL_MIME_PARTS.has(mimeType)) return false
  // Namenloser text/calendar-Teil = Alternative zum Mailtext, die die Einladungskarte
  // zeigt; eine benannte .ics-Datei bleibt als Anhang sichtbar.
  if (mimeType === 'text/calendar' && !(attachment.filename ?? '').trim()) return false

  const contentId = normalizedContentId(attachment.contentId)
  if (!mimeType.startsWith('image/') || !contentId || !html) return true

  return !html.toLowerCase().includes(`cid:${contentId}`)
}
