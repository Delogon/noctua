import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3-multiple-ciphers'
import { htmlToText } from '../mail/parser'
import { cleanupSearchOrphans, refreshMessageSearchIndex } from '../mail/ingest'
import { isLocalOnly } from '../privacy'

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
 * Lokale Embeddings (multilingual-e5-small, quantisiert, ~120 MB einmaliger
 * Download in userData/models). Mail-Inhalte verlassen den Rechner fürs
 * Indexieren nicht. E5 verlangt "passage:"/"query:"-Präfixe.
 */

function modelCacheDir(): string {
  return process.env.NOCTUA_MODEL_CACHE_DIR?.trim() || join(app.getPath('userData'), 'models')
}

/** Liegt das (quantisierte) Modell schon im lokalen Cache? Dann braucht es kein Netz. */
export function isEmbeddingModelCached(): boolean {
  return existsSync(join(modelCacheDir(), EMBEDDING_MODEL, 'onnx', 'model_quantized.onnx'))
}

/** Ohne Download-Erlaubnis (Local only) und ohne Cache steht das Modell nicht bereit. */
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
        // Ohne Download-Erlaubnis: nur Cache, keine Hugging-Face-Anfrage
        local_files_only: !allowDownload
      })
      return pipe as unknown as Extractor
    })()
    extractorPromise.catch(() => {
      extractorPromise = null // Download fehlgeschlagen → nächster Versuch später
    })
  }
  return extractorPromise
}

/** Entfernt URL-/Boilerplate-Rauschen, das Embeddings dominiert (Receipts!). */
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
    /** Modelldateien liegen lokal vor (Suche funktioniert ohne Netz) */
    cached: boolean
    error: string | null
  }
}

/** Indexiert Message-Bodies im Hintergrund in die vec0-Tabelle. */
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

  /** Wahrer lokaler Stand; zaehlt nur aktuelle Vektoren des aktiven Modells. */
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
    // Der Zustand kommt allein aus message_embedding_state (indiziert). Ein
    // `EXISTS (… message_vecs …)` pro Zeile wäre genauer, kostet auf einem
    // 40k-Postfach aber ein bis drei Sekunden im Main-Prozess — und da vec0
    // keinen Rowid-Index hat, wächst das quadratisch. Fehlende Vektoren fängt
    // stattdessen reconcileMissingVectors() einmal pro Sitzung ab.
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
   * Ausdrücklicher Download des Suchmodells (Einstellungen → „Suchmodell laden").
   * Der einzige Weg, der bei Local only ins Netz darf — danach läuft die
   * Indexierung wie gewohnt.
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

  /** Migrationen kennen keine SHA-256-Funktion; bestehende Bodies hier nachziehen. */
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
   * Eine Migration kann die vec0-Tabelle neu anlegen (022 hat das getan),
   * während message_embedding_state die Nachrichten weiter als eingebettet
   * führt. Zwei billige Zählungen erkennen das; nur dann wird der teure
   * Zeilenabgleich fällig — statt bei jedem Poll.
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
    this.ensureSearchStates()
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
    // Local only: ohne gecachtes Modell kein automatischer Download — die
    // Suche läuft dann nur über FTS, bis der Nutzer das Modell ausdrücklich lädt.
    if (isLocalOnly() && !isEmbeddingModelCached()) {
      if (this.modelState !== 'loading') this.modelState = 'not_loaded'
      return
    }
    this.reconcileMissingVectors()
    let rows = this.pendingRows()
    // Der Waisen-Abgleich scannt FTS- und Vektortabelle komplett. Im
    // Normalfall (nichts zu indexieren) lohnt das nicht alle 60 Sekunden —
    // init() räumt beim Start auf, danach nur noch bei echter Arbeit.
    if (rows.length === 0) return
    cleanupSearchOrphans(this.db!)
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
        const vectors = await embed(texts, 'passage')
        this.modelState = 'ready'
        const tx = this.db!.transaction(() => {
          batch.forEach((row, index) => {
            const current = currentHash.get(row.id) as { content_hash: string } | undefined
            // Body koennte sich waehrend der Modell-Inferenz geaendert haben.
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
