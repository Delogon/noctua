// Duration histogram with fixed buckets (shared by main diagnostics and renderer).

/** Bucket upper bounds in ms; the last bucket is "above". */
export const BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 30_000]

export interface Histogram {
  count: number
  totalMs: number
  maxMs: number
  buckets: number[]
}

export interface TimingSummary {
  name: string
  count: number
  totalMs: number
  meanMs: number
  maxMs: number
  p50Ms: number
  p95Ms: number
  p99Ms: number
}

export function emptyHistogram(): Histogram {
  return { count: 0, totalMs: 0, maxMs: 0, buckets: new Array(BUCKETS_MS.length + 1).fill(0) }
}

export function observe(h: Histogram, ms: number): void {
  h.count += 1
  h.totalMs += ms
  if (ms > h.maxMs) h.maxMs = ms
  let i = 0
  while (i < BUCKETS_MS.length && ms > BUCKETS_MS[i]) i += 1
  h.buckets[i] += 1
}

/** Percentile from the histogram: the bucket's upper bound, capped by the maximum. */
export function percentile(h: Pick<Histogram, 'count' | 'maxMs' | 'buckets'>, q: number): number {
  if (h.count === 0) return 0
  const target = q * h.count
  let seen = 0
  for (let i = 0; i < h.buckets.length; i++) {
    seen += h.buckets[i]
    if (seen >= target) return Math.min(BUCKETS_MS[i] ?? h.maxMs, h.maxMs)
  }
  return h.maxMs
}

export function summarize(name: string, h: Histogram): TimingSummary {
  const round = (n: number): number => Math.round(n * 100) / 100
  return {
    name,
    count: h.count,
    totalMs: round(h.totalMs),
    meanMs: round(h.count ? h.totalMs / h.count : 0),
    maxMs: round(h.maxMs),
    p50Ms: round(percentile(h, 0.5)),
    p95Ms: round(percentile(h, 0.95)),
    p99Ms: round(percentile(h, 0.99))
  }
}
