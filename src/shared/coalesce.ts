/**
 * Coalesces bursts of events into one run. Items added within `delayMs` of each
 * other are delivered together (trailing debounce); a continuous stream is
 * still flushed at least every `maxWaitMs`, so refreshes never stall during a
 * long backfill. Shared by main (side effects of messages:changed) and the
 * renderer (query invalidations).
 */
export interface Coalescer<T> {
  add(item: T): void
  /** Runs pending items now (e.g. on shutdown or in tests). */
  flush(): void
  cancel(): void
}

export function createCoalescer<T>(
  run: (items: T[]) => void,
  options: { delayMs: number; maxWaitMs: number }
): Coalescer<T> {
  let items: T[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstAt = 0

  const flush = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
    if (items.length === 0) return
    const batch = items
    items = []
    run(batch)
  }

  return {
    add(item: T): void {
      const now = Date.now()
      if (items.length === 0) firstAt = now
      items.push(item)
      if (timer) clearTimeout(timer)
      const waited = now - firstAt
      if (waited >= options.maxWaitMs) {
        flush()
        return
      }
      timer = setTimeout(flush, Math.min(options.delayMs, options.maxWaitMs - waited))
    },
    flush,
    cancel(): void {
      if (timer) clearTimeout(timer)
      timer = null
      items = []
    }
  }
}
