import type Database from 'better-sqlite3-multiple-ciphers'
import type { OwlConversation, OwlConversationListItem, OwlMessage } from '@shared/types'

interface OwlConversationRow {
  id: number
  title: string
  messages_json: string
  created_at: number
  updated_at: number
}

/**
 * First sentence of an answer for the gist line of the conversation list
 * ("↳ Three — Hetzner, Adobe and a DB ticket."). Deliberately simple:
 * sentence end or line break terminates, overlong sentences are truncated.
 */
export function answerGist(content: string): string | null {
  // Markdown markers don't belong in the single-line gist display
  const plain = content
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,4}\s+/gm, '')
    .replace(/^\s*[-*•]\s+/gm, '')
  const flat = plain.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  const sentence = flat.match(/^.*?[.!?…](?=\s|$)/)?.[0] ?? flat
  return sentence.length > 160 ? `${sentence.slice(0, 159).trimEnd()}…` : sentence
}

function parseMessages(json: string): OwlMessage[] {
  try {
    const parsed: unknown = JSON.parse(json)
    return Array.isArray(parsed) ? (parsed as OwlMessage[]) : []
  } catch {
    return []
  }
}

/** All conversations, newest first — gist from the owl's first answer. */
export function listOwlConversations(db: Database.Database): OwlConversationListItem[] {
  const rows = db
    .prepare('SELECT * FROM owl_conversations ORDER BY updated_at DESC')
    .all() as OwlConversationRow[]
  return rows.map((row) => {
    const firstAnswer = parseMessages(row.messages_json).find((m) => m.role === 'assistant')
    return {
      id: row.id,
      title: row.title,
      updatedAt: row.updated_at,
      answerGist: firstAnswer ? answerGist(firstAnswer.content) : null
    }
  })
}

/** A conversation including its history; null if it no longer exists. */
export function getOwlConversation(db: Database.Database, id: number): OwlConversation | null {
  const row = db.prepare('SELECT * FROM owl_conversations WHERE id = ?').get(id) as
    OwlConversationRow | undefined
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    messages: parseMessages(row.messages_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** Upsert: without id (or with an orphaned id) a new one is created; returns the id. */
export function saveOwlConversation(
  db: Database.Database,
  input: { id?: number; title: string; messages: OwlMessage[] }
): number {
  const now = Date.now()
  const json = JSON.stringify(input.messages)
  if (input.id !== undefined) {
    const updated = db
      .prepare(
        'UPDATE owl_conversations SET title = ?, messages_json = ?, updated_at = ? WHERE id = ?'
      )
      .run(input.title, json, now, input.id)
    if (updated.changes > 0) return input.id
  }
  const result = db
    .prepare(
      `INSERT INTO owl_conversations (title, messages_json, created_at, updated_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(input.title, json, now, now)
  return Number(result.lastInsertRowid)
}

/** Deletes a conversation; true if one existed. */
export function deleteOwlConversation(db: Database.Database, id: number): boolean {
  return db.prepare('DELETE FROM owl_conversations WHERE id = ?').run(id).changes > 0
}
