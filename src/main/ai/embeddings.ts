import { app, powerMonitor } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { htmlToText } from '../mail/parser'
import { cleanupSearchOrphans, refreshMessageSearchIndex } from '../mail/ingest'
import { isLocalOnly } from '../privacy'
import { metrics } from '../diagnostics/metrics'
import { EMBEDDING_MODEL, ExtractorCache, runExtractor, type EmbedPrefix } from './embed-model'

export { EMBEDDING_MODEL }
const BATCH = 8
const SCAN_LIMIT = 48
const POLL_INTERVAL_MS = 60_000
/** Pause between batches on battery: the index is not worth draining it. */
const BATTERY_PAUSE_MS = 2_000
/** The orphan reconciliation scans FTS and vector tables completely. */
const ORPHAN_CLEANUP_INTERVAL_MS = 6 * 60 * 60_000

/**
 * Local embeddings (multilingual-e5-base, quantized, one-time download into
 * userData/models). Mail contents don't leave the machine for indexing.
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

/** Where inference runs: a worker thread in the app, in-process in tests. */
export interface EmbedBackend {
  /** Without texts only loads the model. */
  embed(texts: string[], prefix: EmbedPrefix, allowDownload: boolean): Promise<Float32Array[]>
  stop?(): void
}

class InProcessEmbedder implements EmbedBackend {
  private readonly cache = new ExtractorCache()

  async embed(
    texts: string[],
    prefix: EmbedPrefix,
    allowDownload: boolean
  ): Promise<Float32Array[]> {
    const extractor = await this.cache.get(modelCacheDir(), allowDownload)
    return texts.length > 0 ? runExtractor(extractor, texts, prefix) : []
  }
}

let backend: Promise<EmbedBackend> | null = null

function selectBackend(): Promise<EmbedBackend> {
  if (!backend) {
    backend = (async (): Promise<EmbedBackend> => {
      if (!process.versions.electron || process.env.NOCTUA_EMBED_IN_PROCESS === '1') {
        return new InProcessEmbedder()
      }
      try {
        const { WorkerEmbedder } = await import('./embed-worker-client')
        return new WorkerEmbedder(modelCacheDir())
      } catch (error) {
        console.warn('[embeddings] worker unavailable, embedding in-process:', error)
        return new InProcessEmbedder()
      }
    })()
  }
  return backend
}

/** Test seam: replaces the inference backend (null = default selection). */
export function setEmbedBackend(next: EmbedBackend | null): void {
  void backend?.then((current) => current.stop?.())
  backend = next ? Promise.resolve(next) : null
}

async function embed(
  texts: string[],
  prefix: EmbedPrefix,
  allowDownload = !isLocalOnly()
): Promise<Float32Array[]> {
  if (!allowDownload && !isEmbeddingModelCached()) throw new EmbeddingModelUnavailableError()
  const current = await selectBackend()
  try {
    return await current.embed(texts, prefix, allowDownload)
  } catch (error) {
    // The worker died (or never started): keep search working in-process
    if (error instanceof Error && error.name === 'EmbedWorkerUnavailableError') {
      console.warn('[embeddings] worker failed, embedding in-process:', error.message)
      current.stop?.()
      const fallback = new InProcessEmbedder()
      backend = Promise.resolve(fallback)
      return fallback.embed(texts, prefix, allowDownload)
    }
    throw error
  }
}

function onBattery(): boolean {
  try {
    return powerMonitor.isOnBatteryPower()
  } catch {
    return false
  }
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

/**
 * States that still need a vector, driven from the partial index
 * idx_embed_pending (migration 040): its WHERE must match exactly, including
 * the model literal. Newest messages first, from searchable folders only.
 */
export const PENDING_ROWS_SQL = `SELECT m.id, m.subject, m.from_name, m.from_addr, b.text_plain, b.html_raw,
       coalesce((
         SELECT group_concat(coalesce(a.filename, ''), ' ')
         FROM attachments a WHERE a.message_id = m.id
       ), '') AS attachment_names,
       s.content_hash
  FROM message_embedding_state s
  CROSS JOIN messages m ON m.id = s.message_id
  JOIN message_bodies b ON b.message_id = m.id
  JOIN folders f ON f.id = m.folder_id
  WHERE (
      s.embedded_hash IS NULL
      OR s.embedded_hash != s.content_hash
      OR s.embedding_model IS NULL
      OR s.embedding_model != '${EMBEDDING_MODEL}'
    )
    AND m.body_state = 'full'
    AND f.special_use IN ('\\Inbox', '\\Sent', '\\Archive')
  ORDER BY m.date DESC LIMIT ?`

/** Indexes message bodies in the background into the vec0 table. */
export class EmbeddingIndexer {
  private db: Database.Database | null = null
  private timer: NodeJS.Timeout | null = null
  private startupTimer: NodeJS.Timeout | null = null
  private running = false
  private reconciled = false
  private modelState: EmbeddingModelState = 'not_loaded'
  private modelError: string | null = null
  private lastOrphanCleanup = 0

  init(db: Database.Database): void {
    this.db = db
    const cleaned = cleanupSearchOrphans(db)
    this.lastOrphanCleanup = Date.now()
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
    void backend?.then((current) => current.stop?.())
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
      await embed([], 'passage', true)
      this.modelState = 'ready'
    } catch (error) {
      this.modelState = 'error'
      this.modelError = error instanceof Error ? error.message : String(error)
      throw error
    }
    this.kick()
  }

  /**
   * Migrations have no SHA-256 function; backfill existing bodies here. Once
   * per session (init): every new envelope and body creates its state row.
   */
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
    return this.db!.prepare(PENDING_ROWS_SQL).all(SCAN_LIMIT) as IndexRow[]
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
    if (Date.now() - this.lastOrphanCleanup >= ORPHAN_CLEANUP_INTERVAL_MS) {
      metrics.time('ai.embed.cleanupOrphans', () => cleanupSearchOrphans(this.db!))
      this.lastOrphanCleanup = Date.now()
    }
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
        // Yield between batches; on battery also give the CPU a rest
        await new Promise((resolve) => setTimeout(resolve, onBattery() ? BATTERY_PAUSE_MS : 0))
      }
      console.log(`[embeddings] ${rows.length} Nachrichten indexiert`)
      rows = this.pendingRows()
    }
  }
}

export const embeddingIndexer = new EmbeddingIndexer()
