import type Database from 'better-sqlite3-multiple-ciphers'
import type { SemanticSearchHit, SemanticSearchIndex, SemanticSearchSignal } from '@shared/types'
import { embedQuery, embeddingIndexer } from '../ai/embeddings'
import { htmlToText } from '../mail/parser'
import { foldSharpS } from './fold'
import { fuzzySenderMessageIds } from './fuzzy-sender'
import { dedupeByThread, reciprocalRankFusion } from './ranking'

export interface SemanticSearchInput {
  q: string
  limit: number
  accountId?: number
}

export interface SemanticSearchResult {
  hits: SemanticSearchHit[]
  index: SemanticSearchIndex
  mode: 'hybrid' | 'fulltext'
}

interface RankedMessage {
  messageId: number
}

interface SearchRow {
  message_id: number
  thread_key: string
  account_id: number
  account_name: string | null
  account_email: string
  special_use: string | null
  subject: string | null
  from_name: string | null
  from_addr: string | null
  mail_date: number | null
  snippet: string | null
  text_plain: string | null
  html_raw: string | null
  attachment_names: string
}

export interface SemanticSearchDependencies {
  embedQuery?: (text: string) => Promise<Float32Array[]>
  vectorCandidates?: (
    db: Database.Database,
    vector: Float32Array,
    limit: number,
    accountId?: number
  ) => RankedMessage[]
}

// `draft` fängt auch Entwürfe in Ordnern ohne Special-Use ab. Die
// normalisierte Special-Use-Prüfung deckt \Junk/\Spam, \Trash und \Drafts ab.
const SEARCHABLE_MESSAGE_SQL = `
  m.draft = 0
  AND lower(replace(coalesce(f.special_use, ''), char(92), ''))
      NOT IN ('junk', 'spam', 'trash', 'drafts')
  AND lower(trim(f.path))
      NOT IN ('junk', 'spam', 'trash', 'drafts', 'entwürfe', 'papierkorb')`

const STOP_WORDS = new Set([
  // Natürliche deutsche Fragen
  'aber',
  'als',
  'auch',
  'auf',
  'aus',
  'bei',
  'bin',
  'bis',
  'das',
  'dass',
  'der',
  'die',
  'dieser',
  'diese',
  'dieses',
  'eine',
  'einer',
  'einem',
  'einen',
  'email',
  'mail',
  'für',
  'hat',
  'habe',
  'haben',
  'ich',
  'im',
  'in',
  'ist',
  'mir',
  'mit',
  'meine',
  'meiner',
  'mich',
  'nach',
  'oder',
  'sie',
  'sind',
  'und',
  'von',
  'wann',
  'war',
  'was',
  'wegen',
  'welche',
  'welcher',
  'welchem',
  'welchen',
  'wer',
  'wie',
  'wo',
  'wurde',
  'wurden',
  'zum',
  'zur',
  // Englische Fragen in einem gemischten Postfach
  'a',
  'an',
  'and',
  'are',
  'did',
  'do',
  'email',
  'for',
  'from',
  'how',
  'i',
  'in',
  'is',
  'mail',
  'me',
  'my',
  'of',
  'on',
  'the',
  'to',
  'was',
  'what',
  'when',
  'where',
  'which',
  'who',
  'with'
])

function rawQueryTokens(query: string): string[] {
  return (query.toLocaleLowerCase('de-DE').match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (token) => token.length >= 2
  )
}

/** Aussagekräftige Terme für den lokalen FTS-Pfad. */
export function queryTerms(query: string): string[] {
  const raw = rawQueryTokens(query)
  const meaningful = raw.filter((token) => !STOP_WORDS.has(token))
  return [...new Set(meaningful.length > 0 ? meaningful : raw)].slice(0, 16)
}

/**
 * Only self-built, quoted terms reach MATCH. With the trigram index a quoted
 * term matches any substring — this is what makes German compounds findable
 * ("tafeln" → "großflächentafeln"). Terms below three characters cannot hit
 * the trigram index and are dropped; ß is folded to ss like at index time.
 */
export function buildFtsMatch(query: string): string {
  return queryTerms(query)
    .map((term) => foldSharpS(term))
    .filter((term) => term.length >= 3)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ')
}

function ftsCandidates(
  db: Database.Database,
  query: string,
  limit: number,
  accountId?: number
): RankedMessage[] {
  const match = buildFtsMatch(query)
  if (!match) return []
  return db
    .prepare(
      `SELECT m.id AS messageId
       FROM messages_fts
       JOIN messages m ON m.id = messages_fts.rowid
       JOIN folders f ON f.id = m.folder_id
       WHERE messages_fts MATCH ?
         AND ${SEARCHABLE_MESSAGE_SQL}
         AND (? IS NULL OR m.account_id = ?)
       ORDER BY bm25(messages_fts, 8.0, 4.0, 1.5, 1.0),
                coalesce(m.date, m.internal_date, 0) DESC
       LIMIT ?`
    )
    .all(match, accountId ?? null, accountId ?? null, limit) as RankedMessage[]
}

function vectorBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

export function sqliteVectorCandidates(
  db: Database.Database,
  vector: Float32Array,
  limit: number,
  accountId?: number
): RankedMessage[] {
  // Mehr Nachbarn holen als am Ende gebraucht werden: verbotene Ordner und
  // andere Konten werden erst nach dem vec0-KNN-Schritt herausgefiltert.
  const k = Math.min(500, Math.max(64, limit * 6))
  return db
    .prepare(
      `SELECT m.id AS messageId
       FROM (
         SELECT rowid, distance FROM message_vecs
         WHERE embedding MATCH ? AND k = ?
       ) knn
       JOIN messages m ON m.id = knn.rowid
       JOIN folders f ON f.id = m.folder_id
       WHERE ${SEARCHABLE_MESSAGE_SQL}
         AND (? IS NULL OR m.account_id = ?)
       ORDER BY knn.distance ASC
       LIMIT ?`
    )
    .all(vectorBlob(vector), k, accountId ?? null, accountId ?? null, limit) as RankedMessage[]
}

async function semanticCandidates(
  db: Database.Database,
  query: string,
  limit: number,
  accountId: number | undefined,
  dependencies: SemanticSearchDependencies
): Promise<RankedMessage[]> {
  try {
    const makeEmbedding = dependencies.embedQuery ?? embedQuery
    const vectors = await makeEmbedding(query)
    if (!vectors[0]) return []
    return (dependencies.vectorCandidates ?? sqliteVectorCandidates)(
      db,
      vectors[0],
      limit,
      accountId
    )
  } catch (error) {
    // Modell noch nicht geladen, Download offline oder Index leer: Die
    // lokale Volltextsuche bleibt ohne sichtbaren Fehler nutzbar.
    console.warn(
      '[search] Semantischer Pfad nicht verfügbar, nutze Volltext:',
      error instanceof Error ? error.message : String(error)
    )
    return []
  }
}

function countRows(db: Database.Database, sql: string, accountId?: number): number {
  const row = db.prepare(sql).get(accountId ?? null, accountId ?? null) as { count: number }
  return row.count
}

const INDEX_STATUS_TTL_MS = 60_000
let indexStatusCache: {
  db: Database.Database
  key: number | 'all'
  at: number
  value: SemanticSearchIndex
} | null = null

/**
 * Der Indexstand speist nur die Fusszeile der Eule, zaehlt dafuer aber ueber
 * den gesamten Volltext- und Vektorindex. Frueher lief das bei jedem
 * Sucheingabe-Request mit und blockierte den Main-Prozess sekundenlang. Die
 * Zahl aendert sich nur, waehrend der Indexer im Hintergrund arbeitet — ein
 * Cache von einer Minute reicht dafuer voellig.
 */
function cachedIndexStatus(db: Database.Database, accountId?: number): SemanticSearchIndex {
  const key = accountId ?? 'all'
  const now = Date.now()
  if (
    indexStatusCache &&
    indexStatusCache.db === db &&
    indexStatusCache.key === key &&
    now - indexStatusCache.at < INDEX_STATUS_TTL_MS
  ) {
    return indexStatusCache.value
  }
  const value = semanticIndexStatus(db, accountId)
  indexStatusCache = { db, key, at: now, value }
  return value
}

export function semanticIndexStatus(
  db: Database.Database,
  accountId?: number
): SemanticSearchIndex {
  const base = `FROM messages m
    JOIN folders f ON f.id = m.folder_id
    WHERE ${SEARCHABLE_MESSAGE_SQL}
      AND (? IS NULL OR m.account_id = ?)`
  const totalMessages = countRows(db, `SELECT count(*) AS count ${base}`, accountId)

  let searchableMessages = 0
  let embeddedMessages = 0
  try {
    // Über messages_fts selbst zu zählen liest den kompletten Trigram-Index —
    // auf einem 40k-Postfach bis zu zweieinhalb Sekunden. Die Schattentabelle
    // _docsize hat genau eine Zeile pro indexiertem Dokument, der Treffer wird
    // also zum Punkt-Lookup. Fällt sie weg, zählt der alte Weg weiter.
    searchableMessages = countRows(
      db,
      `SELECT count(*) AS count FROM messages m
       JOIN folders f ON f.id = m.folder_id
       WHERE ${SEARCHABLE_MESSAGE_SQL}
         AND (? IS NULL OR m.account_id = ?)
         AND EXISTS (SELECT 1 FROM messages_fts_docsize d WHERE d.id = m.id)`,
      accountId
    )
  } catch {
    try {
      searchableMessages = countRows(
        db,
        `SELECT count(*) AS count FROM messages_fts ft
         JOIN messages m ON m.id = ft.rowid
         JOIN folders f ON f.id = m.folder_id
         WHERE ${SEARCHABLE_MESSAGE_SQL}
           AND (? IS NULL OR m.account_id = ?)`,
        accountId
      )
    } catch {
      // Eine alte/teilmigrierte DB soll die restliche Suche nicht blockieren.
    }
  }
  try {
    embeddedMessages = countRows(
      db,
      `SELECT count(*) AS count FROM message_vecs vec
       JOIN messages m ON m.id = vec.rowid
       JOIN folders f ON f.id = m.folder_id
       WHERE ${SEARCHABLE_MESSAGE_SQL}
         AND (? IS NULL OR m.account_id = ?)`,
      accountId
    )
  } catch {
    // sqlite-vec nicht geladen: FTS-Status bleibt trotzdem korrekt.
  }

  // Der laufende Indexer kennt zusätzlich Content-Hash und Modellversion und
  // ist deshalb für den globalen Stand genauer als ein bloßer vec0-Count.
  // In isolierten Tests oder vor `init()` bleibt der robuste DB-Wert erhalten.
  if (accountId == null) {
    try {
      const liveStatus = embeddingIndexer.getStatus()
      if (liveStatus.eligible > 0 || liveStatus.indexed > 0) {
        embeddedMessages = Math.min(totalMessages, liveStatus.indexed)
      }
    } catch {
      // Teilmigrierte DB: der oben ermittelte Tabellenstand bleibt erhalten.
    }
  }

  return {
    totalMessages,
    searchableMessages,
    embeddedMessages,
    coverage: totalMessages === 0 ? 0 : embeddedMessages / totalMessages,
    ready: searchableMessages > 0 || embeddedMessages > 0
  }
}

function loadRows(db: Database.Database, messageIds: number[]): Map<number, SearchRow> {
  if (messageIds.length === 0) return new Map()
  const placeholders = messageIds.map(() => '?').join(',')
  const rows = db
    .prepare(
      `SELECT m.id AS message_id, m.thread_key, m.account_id,
              a.account_name, a.email AS account_email, f.special_use,
              m.subject, m.from_name, m.from_addr,
              coalesce(m.date, m.internal_date) AS mail_date,
              m.snippet, b.text_plain, b.html_raw,
              coalesce((
                SELECT group_concat(a2.filename, ' ')
                FROM attachments a2
                WHERE a2.message_id = m.id AND a2.filename IS NOT NULL
              ), '') AS attachment_names
       FROM messages m
       JOIN accounts a ON a.id = m.account_id
       JOIN folders f ON f.id = m.folder_id
       LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.id IN (${placeholders})
         AND ${SEARCHABLE_MESSAGE_SQL}`
    )
    .all(...messageIds) as SearchRow[]
  return new Map(rows.map((row) => [row.message_id, row]))
}

function compactText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function evidenceExcerpt(row: SearchRow, terms: string[], maxLength = 240): string {
  const messageText =
    row.text_plain?.trim() || htmlToText(row.html_raw ?? '') || row.snippet || row.subject || ''
  const body = compactText(
    `${messageText}${row.attachment_names ? ` Anhang: ${row.attachment_names}` : ''}`
  )
  if (body.length <= maxLength) return body

  const lower = body.toLocaleLowerCase('de-DE')
  const foldedLower = foldSharpS(lower)
  const positions = terms
    .map((term) => {
      const needle = term.toLocaleLowerCase('de-DE')
      const direct = lower.indexOf(needle)
      // ß/ss-folded fallback: the offset drifts by one per preceding ß,
      // which is fine for positioning a 240-char excerpt window.
      return direct >= 0 ? direct : foldedLower.indexOf(foldSharpS(needle))
    })
    .filter((position) => position >= 0)
  const firstMatch = positions.length > 0 ? Math.min(...positions) : 0
  const start = Math.max(0, firstMatch - 64)
  const end = Math.min(body.length, start + maxLength)
  return `${start > 0 ? '…' : ''}${body.slice(start, end).trim()}${end < body.length ? '…' : ''}`
}

function mailboxFor(specialUse: string | null): SemanticSearchHit['mailbox'] {
  switch ((specialUse ?? '').toLocaleLowerCase('de-DE').replace(/^\\/, '')) {
    case 'inbox':
      return 'inbox'
    case 'sent':
      return 'sent'
    case 'archive':
      return 'archive'
    default:
      return 'other'
  }
}

function containsTerm(text: string | null, terms: string[]): boolean {
  const normalized = foldSharpS((text ?? '').toLocaleLowerCase('de-DE'))
  return terms.some((term) => normalized.includes(foldSharpS(term)))
}

function matchingTermCount(row: SearchRow, terms: string[]): number {
  const body = compactText(
    `${row.subject ?? ''} ${row.from_name ?? ''} ${row.from_addr ?? ''} ${row.text_plain ?? ''} ${row.snippet ?? ''} ${row.attachment_names}`
  ).toLocaleLowerCase('de-DE')
  return terms.filter((term) => body.includes(term)).length
}

/**
 * Vollständig lokale Hybrid-Suche: FTS5/BM25 und multilingual-e5/sqlite-vec
 * liefern unabhängige Nachrichten-Ranglisten, RRF verbindet sie. Erst danach
 * wird pro Thread dedupliziert.
 */
export async function searchSemantic(
  db: Database.Database,
  input: SemanticSearchInput,
  dependencies: SemanticSearchDependencies = {}
): Promise<SemanticSearchResult> {
  const query = input.q.trim()
  const limit = Math.max(1, Math.min(100, input.limit))
  const candidateLimit = Math.min(400, Math.max(60, limit * 8))

  // Embedding-Erzeugung startet vor der synchronen FTS-Abfrage und kann
  // dadurch parallel Modell-/I/O-Arbeit erledigen.
  const vectorPromise = semanticCandidates(db, query, candidateLimit, input.accountId, dependencies)
  const lexical = ftsCandidates(db, query, candidateLimit, input.accountId)
  // Typo-tolerant sender channel: "mail von jens buetfisch" finds the sender
  // even when FTS misses because of a dropped letter (M92).
  const senderIds = fuzzySenderMessageIds(db, queryTerms(query), 24, input.accountId)
  const semantic = await vectorPromise

  const ranked = reciprocalRankFusion([
    // Weight tuned on the 57-case real-mailbox gold set (M96): 1.3 keeps rare
    // exact matches from being diluted by the broad semantic candidate list.
    { signal: 'fulltext', messageIds: lexical.map((row) => row.messageId), weight: 1.3 },
    { signal: 'semantic', messageIds: semantic.map((row) => row.messageId) },
    { signal: 'sender', messageIds: senderIds, weight: 1.1 }
  ])
  const rowsById = loadRows(
    db,
    ranked.map((candidate) => candidate.messageId)
  )
  const terms = queryTerms(query)
  const hits = ranked.flatMap((candidate): SemanticSearchHit[] => {
    const row = rowsById.get(candidate.messageId)
    if (!row) return []
    const signals: SemanticSearchSignal[] = [...candidate.signals]
    if (containsTerm(row.subject, terms)) signals.push('subject')
    if (containsTerm(`${row.from_name ?? ''} ${row.from_addr ?? ''}`, terms)) {
      signals.push('sender')
    }
    const clear =
      (signals.includes('semantic') && signals.includes('fulltext')) ||
      signals.includes('subject') ||
      signals.includes('sender') ||
      (signals.includes('fulltext') && matchingTermCount(row, terms) >= 2)

    return [
      {
        messageId: row.message_id,
        threadKey: row.thread_key,
        accountId: row.account_id,
        accountName: row.account_name?.trim() || row.account_email,
        mailbox: mailboxFor(row.special_use),
        subject: row.subject,
        fromName: row.from_name,
        fromAddr: row.from_addr,
        date: row.mail_date,
        excerpt: evidenceExcerpt(row, terms),
        signals: [...new Set(signals)],
        confidence: clear ? 'clear' : 'possible'
      }
    ]
  })

  return {
    hits: dedupeByThread(hits, limit),
    index: cachedIndexStatus(db, input.accountId),
    mode: semantic.length > 0 ? 'hybrid' : 'fulltext'
  }
}

/** Lesbarer Alias für Evaluationen und andere Main-Prozess-Aufrufer. */
export const semanticSearch = searchSemantic
