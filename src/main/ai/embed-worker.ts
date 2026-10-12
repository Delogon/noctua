import { parentPort, workerData } from 'node:worker_threads'
import { EMBED_WORKER_MARKER, ExtractorCache, runExtractor, type EmbedPrefix } from './embed-model'

// Embedding inference off the main process: the ONNX model takes tens to
// hundreds of milliseconds per batch, which would otherwise block IPC, sync
// and the UI while the index is being built.

export interface EmbedRequest {
  id: number
  cacheDir: string
  allowDownload: boolean
  /** Without texts: only load the model (explicit download). */
  texts: string[]
  prefix: EmbedPrefix
}

export type EmbedResponse =
  { id: number; vectors: Float32Array[] } | { id: number; error: string; name: string }

export async function handleEmbedRequest(
  cache: ExtractorCache,
  request: EmbedRequest
): Promise<EmbedResponse> {
  try {
    const extractor = await cache.get(request.cacheDir, request.allowDownload)
    const vectors =
      request.texts.length > 0 ? await runExtractor(extractor, request.texts, request.prefix) : []
    return { id: request.id, vectors }
  } catch (error) {
    return {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Error'
    }
  }
}

const port = parentPort
if (port && (workerData as Record<string, unknown> | null)?.[EMBED_WORKER_MARKER] === true) {
  const cache = new ExtractorCache()
  port.on('message', (request: EmbedRequest) => {
    void handleEmbedRequest(cache, request).then((response) => {
      const transfer = 'vectors' in response ? response.vectors.map((v) => v.buffer) : []
      port.postMessage(response, transfer as ArrayBuffer[])
    })
  })
}
