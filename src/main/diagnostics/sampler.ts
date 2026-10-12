import { monitorEventLoopDelay } from 'node:perf_hooks'

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>
import { metrics } from './metrics'

// Zeitreihe der Prozesslast: CPU, Speicher, Event-Loop-Verzögerung des Main-
// Prozesses (blockierte Loop = hängende UI-Antworten), dazu die Electron-
// Prozesse (Renderer, GPU) und wie viel SQL/IPC im Intervall lief. Ringpuffer.

export interface ProcessSample {
  t: number
  /** CPU des Main-Prozesses in % eines Kerns */
  mainCpuPct: number
  rssMb: number
  heapUsedMb: number
  externalMb: number
  /** Event-Loop-Verzögerung (ms) im Intervall */
  loopP50Ms: number
  loopP99Ms: number
  loopMaxMs: number
  /** Summe aller Electron-Prozesse (CPU % / Arbeitsspeicher MB), falls verfügbar */
  appCpuPct: number | null
  appMemMb: number | null
  rendererCpuPct: number | null
  gpuCpuPct: number | null
  /** Last im Intervall */
  sqlCalls: number
  sqlMs: number
  ipcCalls: number
  ipcMs: number
}

export interface AppProcessMetric {
  type: string
  cpu: { percentCPUUsage: number }
  memory?: { workingSetSize: number }
}

const MAX_SAMPLES = 720

export class ProcessSampler {
  private samples: ProcessSample[] = []
  private timer: NodeJS.Timeout | null = null
  private loop: IntervalHistogram | null = null
  private lastCpu = process.cpuUsage()
  private lastAt = Date.now()
  private lastTotals = metrics.totals()

  constructor(private readonly getAppMetrics: (() => AppProcessMetric[]) | null = null) {}

  start(intervalMs = 5000): void {
    if (this.timer) return
    this.loop = monitorEventLoopDelay({ resolution: 20 })
    this.loop.enable()
    this.lastCpu = process.cpuUsage()
    this.lastAt = Date.now()
    this.lastTotals = metrics.totals()
    this.timer = setInterval(() => this.sample(), intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.loop?.disable()
    this.loop = null
  }

  sample(): ProcessSample {
    const now = Date.now()
    const elapsedMs = Math.max(1, now - this.lastAt)
    const cpu = process.cpuUsage(this.lastCpu)
    const mem = process.memoryUsage()
    const mb = (bytes: number): number => Math.round((bytes / 1024 / 1024) * 10) / 10
    const ns = (v: number): number => Math.round((v / 1e6) * 10) / 10
    let appCpuPct: number | null = null
    let appMemMb: number | null = null
    let rendererCpuPct: number | null = null
    let gpuCpuPct: number | null = null
    try {
      const list = this.getAppMetrics?.() ?? null
      if (list) {
        appCpuPct = 0
        appMemMb = 0
        for (const p of list) {
          appCpuPct += p.cpu.percentCPUUsage
          appMemMb += (p.memory?.workingSetSize ?? 0) / 1024
          if (p.type === 'Tab') rendererCpuPct = (rendererCpuPct ?? 0) + p.cpu.percentCPUUsage
          if (p.type === 'GPU') gpuCpuPct = (gpuCpuPct ?? 0) + p.cpu.percentCPUUsage
        }
        appCpuPct = Math.round(appCpuPct * 10) / 10
        appMemMb = Math.round(appMemMb * 10) / 10
      }
    } catch {
      // Electron-Metriken nicht verfügbar (Tests)
    }
    const totals = metrics.totals()
    const sample: ProcessSample = {
      t: now,
      mainCpuPct: Math.round(((cpu.user + cpu.system) / 1000 / elapsedMs) * 1000) / 10,
      rssMb: mb(mem.rss),
      heapUsedMb: mb(mem.heapUsed),
      externalMb: mb(mem.external),
      loopP50Ms: this.loop ? ns(this.loop.percentile(50)) : 0,
      loopP99Ms: this.loop ? ns(this.loop.percentile(99)) : 0,
      loopMaxMs: this.loop ? ns(this.loop.max) : 0,
      appCpuPct,
      appMemMb,
      rendererCpuPct,
      gpuCpuPct,
      sqlCalls: totals.sqlCalls - this.lastTotals.sqlCalls,
      sqlMs: Math.round(totals.sqlMs - this.lastTotals.sqlMs),
      ipcCalls: totals.ipcCalls - this.lastTotals.ipcCalls,
      ipcMs: Math.round(totals.ipcMs - this.lastTotals.ipcMs)
    }
    this.loop?.reset()
    this.lastCpu = process.cpuUsage()
    this.lastAt = now
    this.lastTotals = totals
    if (metrics.enabled) {
      this.samples.push(sample)
      if (this.samples.length > MAX_SAMPLES)
        this.samples.splice(0, this.samples.length - MAX_SAMPLES)
    }
    return sample
  }

  list(): ProcessSample[] {
    return [...this.samples]
  }

  clear(): void {
    this.samples = []
  }
}
