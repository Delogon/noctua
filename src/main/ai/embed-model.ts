// The embedding model itself, without Electron: used in-process and by the
// embedding worker thread (embed-worker.ts).

export const EMBEDDING_MODEL = 'Xenova/multilingual-e5-base'
export const EMBEDDING_DIMS = 768

/** workerData flag set by WorkerEmbedder; importing embed-worker elsewhere stays inert. */
export const EMBED_WORKER_MARKER = 'noctuaEmbedWorker'

/** E5 requires "passage:"/"query:" prefixes. */
export type EmbedPrefix = 'passage' | 'query'

export type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>

/** Loads the quantized model; without download permission only from the cache. */
export async function loadExtractor(cacheDir: string, allowDownload: boolean): Promise<Extractor> {
  const { env, pipeline } = await import('@huggingface/transformers')
  env.cacheDir = cacheDir
  const pipe = await pipeline('feature-extraction', EMBEDDING_MODEL, {
    dtype: 'q8',
    // Without download permission: cache only, no Hugging Face request
    local_files_only: !allowDownload
  })
  return pipe as unknown as Extractor
}

export async function runExtractor(
  extractor: Extractor,
  texts: string[],
  prefix: EmbedPrefix
): Promise<Float32Array[]> {
  const output = await extractor(
    texts.map((t) => `${prefix}: ${t}`),
    { pooling: 'mean', normalize: true }
  )
  const results: Float32Array[] = []
  for (let i = 0; i < texts.length; i++) {
    // slice copies: every vector owns its buffer (transferable to the main thread)
    results.push(output.data.slice(i * EMBEDDING_DIMS, (i + 1) * EMBEDDING_DIMS))
  }
  return results
}

/**
 * Keeps one extractor per process. A failed load (download error, missing
 * cache) is forgotten so the next call can retry, possibly with download
 * permission.
 */
export class ExtractorCache {
  private promise: Promise<Extractor> | null = null

  constructor(private readonly load: typeof loadExtractor = loadExtractor) {}

  get(cacheDir: string, allowDownload: boolean): Promise<Extractor> {
    if (!this.promise) {
      const promise = this.load(cacheDir, allowDownload)
      promise.catch(() => {
        if (this.promise === promise) this.promise = null
      })
      this.promise = promise
    }
    return this.promise
  }
}
