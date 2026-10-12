import type { Worker } from 'node:worker_threads'
import createEmbedWorker from './embed-worker?nodeWorker'
import { EMBED_WORKER_MARKER, type EmbedPrefix } from './embed-model'
import type { EmbedRequest, EmbedResponse } from './embed-worker'

/** The worker died or could not start; the caller falls back to in-process. */
export class EmbedWorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EmbedWorkerUnavailableError'
  }
}

/** Runs embeddings in a worker thread (one request at a time per batch). */
export class WorkerEmbedder {
  private worker: Worker | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }
  >()

  constructor(private readonly cacheDir: string) {}

  embed(texts: string[], prefix: EmbedPrefix, allowDownload: boolean): Promise<Float32Array[]> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const request: EmbedRequest = { id, cacheDir: this.cacheDir, allowDownload, texts, prefix }
      worker.postMessage(request)
    })
  }

  stop(): void {
    void this.worker?.terminate()
    this.worker = null
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    const worker = createEmbedWorker({ workerData: { [EMBED_WORKER_MARKER]: true } })
    // The index is background work: the worker must not keep the app alive
    worker.unref()
    worker.on('message', (response: EmbedResponse) => {
      const entry = this.pending.get(response.id)
      if (!entry) return
      this.pending.delete(response.id)
      if ('vectors' in response) entry.resolve(response.vectors)
      else {
        const error = new Error(response.error)
        error.name = response.name
        entry.reject(error)
      }
    })
    const fail = (reason: string): void => {
      if (this.worker === worker) this.worker = null
      const error = new EmbedWorkerUnavailableError(reason)
      for (const entry of this.pending.values()) entry.reject(error)
      this.pending.clear()
    }
    worker.on('error', (error) => fail(error.message))
    worker.on('exit', (code) => fail(`embedding worker exited (${code})`))
    this.worker = worker
    return worker
  }
}
