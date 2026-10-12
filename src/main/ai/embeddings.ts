import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { htmlToText } from '../mail/parser'
import { cleanupSearchOrphans, refreshMessageSearchIndex } from '../mail/ingest'
import { isLocalOnly } from '../privacy'
import { metrics } from '../diagnostics/metrics'

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-base'
const DIMS = 768
const BATCH = 8
const SCAN_LIMIT = 48
const POLL_INTERVAL_MS = 60_000

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>

let extractorPromise: Promise<Extractor> | null = null

/**
 * Local embeddings (multilingual-e5-small, quantized, ~120 MB one-time
 * download into userData/models). Mail contents don't leave the machine for
 * indexing. E5 requires "passage:"/"query:" prefixes.
 */

function modelCacheDir(): string {
  return process.env.NOCTUA_MODEL_CACHE_DIR?.trim() || join(app.getPath('userData'), 'models')
}

/** Is the (quantized) model already in the local cache? Then it needs no network. */
export function isEmbeddingModelCached(): boolean {
  return existsSync(join(modelCacheDir(), EMBEDDING_MODEL, 'onnx', 'model_quantized.onnx'))
}

/** Without download permission (Local only) and without cache the model is unavailable. */
export class EmbeddingModelUnavailableError extends Error {
  constructor() {
    super('Suchmodell nicht geladen („Nur lokal“: Download nur auf Anfrage)')
    this.name = 'EmbeddingModelUnavailableError'
  }
}

async function getExtractor(allowDownload = !isLocalOnly()): Promise<Extractor> {
  if (!extractorPromise) {
    if (!allowDownload && !isEmbeddingModelCached()) throw new EmbeddingModelUnavailableError()
    extractorPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers')
      env.cacheDir = modelCacheDir()
      const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL, {
        dtype: 'q8',
        // Without download permission: cache only, no Hugging Face request
        local_files_only: !allowDownload
      })
      return pipe as unknown as Extractor
    })()
    extractorPromise.catch(() => {
      extractorPromise = null // download failed → retry later
    })
  }
  return extractorPromise
}

/** Removes URL/boilerplate noise that dominates embeddings (receipts!). */
export function cleanForEmbedding(text: string): string {
  return text
    .replace(/\[image:[^\]]*\]/gi, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\([\s,]*\)/g, ' ')
    .replace(/[-_=*]{4,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function embed(texts: string[], prefix: 'passage' | 'query'): Promise<Float32Array[]> {
  const extractor = await getExtractor()
  const output = await extractor(
    texts.map((t) => `${prefix}: ${t}`),
    { pooling: 'mean', normalize: true }
  )
  const results: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    results.push(output.data.slice(i * DIMS, (i + 1) * DIMS) as Float32Array)
  }
  return results
}

export function embedQuery(text: string): Promise<Float32Array[]> {
  return embed([text.slice(0, 1500)], 'query')
}

function toBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength)
}

interface IndexRow {
  id: number
  subject: string | null
  from_name: string | null
  from_addr: string | null
  text_plain: string | null
  html_raw: string | null
  attachment_names: string
  content_hash: string
}

export type EmbeddingModelState = 'not_loaded' | 'loading' | 'ready' | 'error'

export interface EmbeddingIndexStatus {
  eligible: number
  indexed: number
  pending: number
  running: boolean
  model: {
    id: typeof EMBEDDING_MODEL
    state: EmbeddingModelState
    /** Model files are available locally (search works without network) */
    cached: boolean
    error: string | null
  }
}

/** Indexes message bodies in the background into the vec0 table. */
export class EmbeddingIndexer {
  private db: Database.Database | null = null
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private running = false
  private reconciled = false
  private modelState: EmbeddingModelState = 'not_loaded'
  private modelError: string | null = null

  init(db: Database.Database): void {
    this.db = db
    const cleaned = cleanupSearchOrphans(db)
    if (cleaned.fts + cleaned.vectors + cleaned.states > 0) {
      console.log(
        `[embeddings] Orphans entfernt: ${cleaned.fts} FTS, ${cleaned.vectors} Vektoren, ${cleaned.states} Staende`
      )
    }
    this.ensureSearchStates()
  }

  start(): void {
    if (!this.db) return
    if (process.env.NOCTUA_REINDEX === '1') {
      try {
        this.db.prepare('DELETE FROM message_vecs').run()
        this.db
          .prepare(
            `UPDATE message_embedding_state
             SET embedded_hash = NULL, embedding_model = NULL, indexed_at = NULL`
          )
          .run()
        console.log('[embeddings] Index geleert (NOCTUA_REINDEX)')
      } catch (error) {
        console.warn('[embeddings] reindex:', error)
      }
    }
    this.startupTimer = setTimeout(() => this.kick(), 30_000)
    this.timer = setInterval(() => this.kick(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.startupTimer) clearTimeout(this.startupTimer)
    this.timer = null
    this.startupTimer = null
  }

  isReady(): boolean {
    return this.modelState === 'ready'
  }

  /** True local state; counts only current vectors of the active model. */
  getStatus(): EmbeddingIndexStatus {
    if (!this.db) {
      return {
        eligible: 0,
        indexed: 0,
        pending: 0,
        running: this.running,
        model: {
          id: EMBEDDING_MODEL,
          state: this.modelState,
          cached: isEmbeddingModelCached(),
          error: this.modelError
        }
      }
    }
    // The state comes solely from message_embedding_state (indexed). An
    // `EXISTS (… message_vecs …)` per row would be more accurate, but costs one to
    // three seconds in the main process on a 40k mailbox — and since vec0
    // has no rowid index, it grows quadratically. Missing vectors are instead
    // caught once per session by reconcileMissingVectors().
    const counts = this.db
      .prepare(
        `SELECT count(*) AS eligible,
                coalesce(sum(CASE WHEN
                  s.embedded_hash = s.content_hash
                  AND s.embedding_model = ?
                THEN 1 ELSE 0 END), 0) AS indexed
         FROM messages m
         JOIN message_bodies b ON b.message_id = m.id
         JOIN folders f ON f.id = m.folder_id
         LEFT JOIN message_embedding_state s ON s.message_id = m.id
         WHERE m.body_state = 'full'
           AND f.special_use IN ('\\Inbox', '\\Sent', '\\Archive')`
      )
      .get(EMBEDDING_MODEL) as { eligible: number; indexed: number }
    return {
      eligible: counts.eligible,
      indexed: counts.indexed,
      pending: Math.max(0, counts.eligible - counts.indexed),
      running: this.running,
      model: {
        id: EMBEDDING_MODEL,
        state: this.modelState,
        cached: isEmbeddingModelCached(),
        error: this.modelError
      }
    }
  }

  kick(): void {
    if (!this.db || this.running) return
    this.running = true
    void this.drain()
      .catch((error) => {
        this.modelState = 'error'
        this.modelError = error instanceof Error ? error.message : String(error)
        console.warn('[embeddings]', this.modelError)
      })
      .finally(() => {
        this.running = false
      })
  }

  /**
   * Explicit download of the search model (Settings → "Load search model").
   * The only path allowed onto the network under Local only — afterwards
   * indexing runs as usual.
   */
  async downloadModel(): Promise<void> {
    this.modelState = 'loading'
    this.modelError = null
    try {
      await getExtractor(true)
      this.modelState = 'ready'
    } catch (error) {
      this.modelState = 'error'
      this.modelError = error instanceof Error ? error.message : String(error)
      throw error
    }
    this.kick()
  }

  /** Migrations have no SHA-256 function; backfill existing bodies here. */
  private ensureSearchStates(): void {
    if (!this.db) return
    const missing = this.db
      .prepare(
        `SELECT m.id FROM messages m
         JOIN folders f ON f.id = m.folder_id
         WHERE m.body_state = 'full'
           AND f.special_use IN ('\\Inbox', '\\Sent', '\\Archive')
           AND NOT EXISTS (
             SELECT 1 FROM message_embedding_state s WHERE s.message_id = m.id
           )`
      )
      .all() as Array<{ id: number }>
    if (missing.length === 0) return
    this.db.transaction(() => {
      missing.forEach(({ id }) => refreshMessageSearchIndex(this.db!, id))
    })()
  }

  /**
   * A migration can recreate the vec0 table (022 did that),
   * while message_embedding_state still lists the messages as embedded.
   * Two cheap counts detect this; only then is the expensive
   * row reconciliation due — instead of on every poll.
   */
  private reconcileMissingVectors(): void {
    if (this.reconciled || !this.db) return
    this.reconciled = true
    try {
      const { n: vectors } = this.db.prepare('SELECT count(*) AS n FROM message_vecs').get() as {
        n: number
      }
      const { n: claimed } = this.db
        .prepare(
          `SELECT count(*) AS n FROM message_embedding_state
           WHERE embedding_model = ? AND embedded_hash = content_hash`
        )
        .get(EMBEDDING_MODEL) as { n: number }
      if (vectors >= claimed) return
      const cleared = this.db
        .prepare(
          `UPDATE message_embedding_state
           SET embedded_hash = NULL, embedding_model = NULL, indexed_at = NULL
           WHERE embedded_hash IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM message_vecs v WHERE v.rowid = message_id)`
        )
        .run().changes
      if (cleared > 0) console.log(`[embeddings] ${cleared} verwaiste Staende zurueckgesetzt`)
    } catch (error) {
      console.warn('[embeddings] reconcile:', error)
    }
  }

  private pendingRows(): IndexRow[] {
    metrics.time('ai.embed.ensureStates', () => this.ensureSearchStates())
    return this.db!.prepare(
      `SELECT m.id, m.subject, m.from_name, m.from_addr, b.text_plain, b.html_raw,
                coalesce((
                  SELECT group_concat(coalesce(a.filename, ''), ' ')
                  FROM attachments a WHERE a.message_id = m.id
                ), '') AS attachment_names,
                s.content_hash
         FROM messages m JOIN message_bodies b ON b.message_id = m.id
         JOIN folders f ON f.id = m.folder_id
         JOIN message_embedding_state s ON s.message_id = m.id
         WHERE m.body_state = 'full'
           AND f.special_use IN ('\\Inbox', '\\Sent', '\\Archive')
           AND (
             s.embedded_hash IS NULL
             OR s.embedded_hash != s.content_hash
             OR s.embedding_model IS NULL
             OR s.embedding_model != ?
           )
         ORDER BY m.date DESC LIMIT ?`
    ).all(EMBEDDING_MODEL, SCAN_LIMIT) as IndexRow[]
  }

  private async drain(): Promise<void> {
    // Local only: without a cached model no automatic download — search
    // then runs via FTS only until the user explicitly loads the model.
    if (isLocalOnly() && !isEmbeddingModelCached()) {
      if (this.modelState !== 'loading') this.modelState = 'not_loaded'
      return
    }
    this.reconcileMissingVectors()
    let rows = this.pendingRows()
    // The orphan reconciliation scans the FTS and vector tables completely. In
    // the normal case (nothing to index) that's not worth it every 60 seconds —
    // init() cleans up on start, afterwards only when there's real work.
    if (rows.length === 0) return
    metrics.time('ai.embed.cleanupOrphans', () => cleanupSearchOrphans(this.db!))
    const insert = this.db!.prepare('INSERT INTO message_vecs (rowid, embedding) VALUES (?, ?)')
    const remove = this.db!.prepare('DELETE FROM message_vecs WHERE rowid = ?')
    const currentHash = this.db!.prepare(
      'SELECT content_hash FROM message_embedding_state WHERE message_id = ?'
    )
    const markIndexed = this.db!.prepare(
      `UPDATE message_embedding_state
       SET embedded_hash = ?, embedding_model = ?, indexed_at = ?, updated_at = ?
       WHERE message_id = ? AND content_hash = ?`
    )

    while (rows.length > 0) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH)
        const texts = batch.map((row) => {
          const raw = row.text_plain?.trim() || htmlToText(row.html_raw ?? '')
          const body = cleanForEmbedding(raw).slice(0, 1200)
          const attachments = row.attachment_names ? `\nAnhaenge: ${row.attachment_names}` : ''
          return `${row.subject ?? ''}\nVon: ${row.from_name ?? row.from_addr ?? ''}\n${body}${attachments}`
        })
        if (this.modelState !== 'ready') this.modelState = 'loading'
        this.modelError = null
        const vectors = await metrics.timeAsync('ai.embed.batch', () => embed(texts, 'passage'), {
          messages: batch.length
        })
        metrics.count('ai.embed.messages', batch.length)
        this.modelState = 'ready'
        const tx = this.db!.transaction(() => {
          batch.forEach((row, index) => {
            const current = currentHash.get(row.id) as { content_hash: string } | undefined
            // Body might have changed during model inference.
            if (!current || current.content_hash !== row.content_hash) return
            remove.run(BigInt(row.id))
            insert.run(BigInt(row.id), toBlob(vectors[index]))
            const now = Date.now()
            markIndexed.run(row.content_hash, EMBEDDING_MODEL, now, now, row.id, row.content_hash)
          })
        })
        tx()
      }
      console.log(`[embeddings] ${rows.length} Nachrichten indexiert`)
      rows = this.pendingRows()
    }
  }
}

export const embeddingIndexer = new EmbeddingIndexer()
