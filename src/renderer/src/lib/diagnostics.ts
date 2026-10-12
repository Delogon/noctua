import { emptyHistogram, observe, summarize, type Histogram } from '@shared/histogram'

// Renderer-Seite der Leistungsdiagnose: Antwortzeit jedes IPC-Aufrufs (inkl.
// Serialisierung) und lange Tasks (> 50 ms blockierter UI-Thread = Ruckeln).
// Bleibt im Speicher; nur beim ZIP-Export geht eine Zusammenfassung an Main.

const ipc = new Map<string, Histogram>()
const longTasks = {
  count: 0,
  totalMs: 0,
  maxMs: 0,
  recent: [] as Array<{ at: number; ms: number }>
}
let observing = false

export function recordInvoke(channel: string, ms: number): void {
  let h = ipc.get(channel)
  if (!h) {
    if (ipc.size >= 300) return
    h = emptyHistogram()
    ipc.set(channel, h)
  }
  observe(h, ms)
}

/** Lange Tasks beobachten (Chromium: PerformanceObserver 'longtask'). */
export function startLongTaskObserver(): void {
  if (observing || typeof PerformanceObserver === 'undefined') return
  if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return
  observing = true
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTasks.count += 1
      longTasks.totalMs += entry.duration
      longTasks.maxMs = Math.max(longTasks.maxMs, entry.duration)
      longTasks.recent.push({ at: Date.now(), ms: Math.round(entry.duration) })
      if (longTasks.recent.length > 100) longTasks.recent.shift()
    }
  }).observe({ type: 'longtask', buffered: true })
}

export interface RendererDiagnosticsSnapshot {
  ipc: ReturnType<typeof summarize>[]
  longTasks: typeof longTasks
  heapUsedMb: number | null
}

export function rendererDiagnostics(): RendererDiagnosticsSnapshot {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return {
    ipc: [...ipc].map(([name, h]) => summarize(name, h)).sort((a, b) => b.totalMs - a.totalMs),
    longTasks: {
      count: longTasks.count,
      totalMs: Math.round(longTasks.totalMs),
      maxMs: Math.round(longTasks.maxMs),
      recent: [...longTasks.recent]
    },
    heapUsedMb: memory ? Math.round((memory.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null
  }
}

export function clearRendererDiagnostics(): void {
  ipc.clear()
  longTasks.count = 0
  longTasks.totalMs = 0
  longTasks.maxMs = 0
  longTasks.recent = []
}
