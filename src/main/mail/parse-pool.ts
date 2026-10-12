import type { Worker } from 'node:worker_threads'
import createParseWorker from './parse-worker?nodeWorker'
import { PARSE_WORKER_MARKER, type ParsedMail } from './parser'
import type { ParseRequest, ParseResponse } from './parse-worker'

/** A worker died or could not start; the caller falls back to in-process. */
export class ParseWorkerUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseWorkerUnavailableError'
  }
}

interface Slot {
  worker: Worker
  pending: Map<number, { resolve: (p: ParsedMail) => void; reject: (e: Error) => void }>
}

/** A few parse workers; each request goes to the least busy one. */
export class ParsePool {
  private readonly slots: Array<Slot | null>
  private nextId = 1

  constructor(size: number) {
    this.slots = Array.from({ length: Math.max(1, size) }, () => null)
  }

  parse(source: Uint8Array): Promise<ParsedMail> {
    const slot = this.pickSlot()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      slot.pending.set(id, { resolve, reject })
      // Structured clone copies the bytes: the source may share a pooled buffer
      const request: ParseRequest = { id, source }
      slot.worker.postMessage(request)
    })
  }

  stop(): void {
    for (const slot of this.slots) void slot?.worker.terminate()
    this.slots.fill(null)
  }

  private pickSlot(): Slot {
    let best = -1
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]
      if (!slot) return (this.slots[i] = this.spawn(i))
      if (best === -1 || slot.pending.size < this.slots[best]!.pending.size) best = i
    }
    return this.slots[best]!
  }

  private spawn(index: number): Slot {
    const worker = createParseWorker({ workerData: { [PARSE_WORKER_MARKER]: true } })
    // Background work: the workers must not keep the app alive
    worker.unref()
    const slot: Slot = { worker, pending: new Map() }
    worker.on('message', (response: ParseResponse) => {
      const entry = slot.pending.get(response.id)
      if (!entry) return
      slot.pending.delete(response.id)
      if ('parsed' in response) entry.resolve(response.parsed)
      else entry.reject(new Error(response.error))
    })
    const fail = (reason: string): void => {
      if (this.slots[index] === slot) this.slots[index] = null
      const error = new ParseWorkerUnavailableError(reason)
      for (const entry of slot.pending.values()) entry.reject(error)
      slot.pending.clear()
    }
    worker.on('error', (error) => fail(error.message))
    worker.on('exit', (code) => fail(`parse worker exited (${code})`))
    return slot
  }
}
