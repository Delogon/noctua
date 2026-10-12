import type Database from 'better-sqlite3-multiple-ciphers'
import type { DraftItem } from '@shared/types'

interface DraftRow {
  thread_key: string
  display_name: string | null
  subject: string | null
  text: string
  html: string
  updated_at: number
}

/**
 * Speichert den Entwurf zu einem Thread (Upsert). Anzeigename und Betreff
 * werden aus der jüngsten Nachricht des Threads übernommen, damit die
 * Eulen-Leiste den Entwurf auch dann beschriften kann, wenn der Thread
 * nicht mehr in der geladenen Liste steht (z. B. nach dem Archivieren).
 */
export function saveDraft(
  db: Database.Database,
  threadKey: string,
  text: string,
  html: string
): void {
  const name = db
    .prepare(
      `SELECT from_name FROM messages
       WHERE thread_key = ? AND from_name IS NOT NULL ORDER BY date DESC LIMIT 1`
    )
    .get(threadKey) as { from_name: string } | undefined
  const subject = db
    .prepare('SELECT subject FROM messages WHERE thread_key = ? ORDER BY date DESC LIMIT 1')
    .get(threadKey) as { subject: string | null } | undefined
  db.prepare(
    `INSERT INTO drafts (thread_key, display_name, subject, text, html, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(thread_key) DO UPDATE SET
       text = excluded.text,
       html = excluded.html,
       display_name = coalesce(excluded.display_name, drafts.display_name),
       subject = coalesce(excluded.subject, drafts.subject),
       updated_at = excluded.updated_at`
  ).run(threadKey, name?.from_name ?? null, subject?.subject ?? null, text, html, Date.now())
}

/** Alle gespeicherten Entwürfe, jüngste zuerst. */
export function listDrafts(db: Database.Database): DraftItem[] {
  const rows = db.prepare('SELECT * FROM drafts ORDER BY updated_at DESC').all() as DraftRow[]
  return rows.map((row) => ({
    threadKey: row.thread_key,
    displayName: row.display_name,
    subject: row.subject,
    text: row.text,
    html: row.html,
    updatedAt: row.updated_at
  }))
}

/** Löscht den Entwurf eines Threads; true, wenn einer existierte. */
export function deleteDraft(db: Database.Database, threadKey: string): boolean {
  return db.prepare('DELETE FROM drafts WHERE thread_key = ?').run(threadKey).changes > 0
}
