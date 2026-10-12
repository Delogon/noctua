import { app, dialog } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import PostalMime from 'postal-mime'
import { syncEngine } from '../sync/engine'
import { sanitizeFilename } from './filename'

interface AttachmentRow {
  id: number
  message_id: number
  part_id: string
  filename: string | null
  mime_type: string | null
  content_id: string | null
}

/**
 * Lädt den Roh-Source der Nachricht und extrahiert Attachments via postal-mime.
 * Bewusst simpel (ganze Mail statt IMAP-Part-Fetch) — ausreichend für typische
 * Größen; BODYSTRUCTURE-Part-Fetching ist der dokumentierte Optimierungspunkt.
 */
async function loadParsedAttachments(messageId: number): Promise<
  Array<{
    index: number
    filename: string | null
    contentId: string | null
    mimeType: string | null
    content: Uint8Array
  }>
> {
  const source = await syncEngine.fetchRawSource(messageId)
  if (!source) throw new Error('Nachricht nicht abrufbar (Konto offline?)')
  const email = await PostalMime.parse(source, { maxNestingDepth: 64 })
  return (email.attachments ?? []).map((att, index) => ({
    index,
    filename: att.filename ?? null,
    contentId: att.contentId?.replace(/[<>]/g, '') ?? null,
    mimeType: att.mimeType ?? null,
    content:
      att.content instanceof ArrayBuffer
        ? new Uint8Array(att.content)
        : new TextEncoder().encode(String(att.content ?? ''))
  }))
}

export async function saveAttachment(
  db: Database.Database,
  attachmentId: number
): Promise<string | null> {
  const row = db
    .prepare(
      'SELECT id, message_id, part_id, filename, mime_type, content_id FROM attachments WHERE id = ?'
    )
    .get(attachmentId) as AttachmentRow | undefined
  if (!row) throw new Error('Anhang nicht gefunden')

  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: join(app.getPath('downloads'), sanitizeFilename(row.filename)),
    securityScopedBookmarks: false
  })
  if (canceled || !filePath) return null

  const parsed = await loadParsedAttachments(row.message_id)
  const match = parsed[Number(row.part_id)] ?? parsed.find((p) => p.filename === row.filename)
  if (!match) throw new Error('Anhang im Original nicht gefunden')
  await writeFile(filePath, match.content)
  return filePath
}

const MAX_INLINE_BYTES = 2 * 1024 * 1024

/** cid: → data:-URIs für Inline-Bilder einer Nachricht. */
export async function getInlineImages(
  db: Database.Database,
  messageId: number
): Promise<Record<string, string>> {
  const hasCid = db
    .prepare('SELECT 1 FROM attachments WHERE message_id = ? AND content_id IS NOT NULL LIMIT 1')
    .get(messageId)
  if (!hasCid) return {}
  const parsed = await loadParsedAttachments(messageId)
  const result: Record<string, string> = {}
  for (const att of parsed) {
    if (!att.contentId || !att.mimeType?.startsWith('image/')) continue
    if (att.content.byteLength > MAX_INLINE_BYTES) continue
    result[att.contentId] =
      `data:${att.mimeType};base64,${Buffer.from(att.content).toString('base64')}`
  }
  return result
}
