import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescer } from '@shared/coalesce'

describe('createCoalescer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('delivers a burst as one batch after the quiet period', () => {
    const run = vi.fn()
    const c = createCoalescer<number>(run, { delayMs: 300, maxWaitMs: 1000 })
    c.add(1)
    vi.advanceTimersByTime(100)
    c.add(2)
    vi.advanceTimersByTime(100)
    c.add(3)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(300)
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith([1, 2, 3])
  })

  it('flushes a continuous stream at least every maxWait', () => {
    const run = vi.fn()
    const c = createCoalescer<number>(run, { delayMs: 300, maxWaitMs: 1000 })
    for (let i = 0; i < 20; i++) {
      c.add(i)
      vi.advanceTimersByTime(200)
    }
    // 4 s of events every 200 ms: never quiet, but flushed about once per second
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(3)
    expect(run.mock.calls.length).toBeLessThanOrEqual(5)
    vi.runAllTimers()
    expect(run.mock.calls.flatMap((call) => call[0])).toEqual([...Array(20).keys()])
  })

  it('flush runs pending items immediately; cancel drops them', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delayMs: 300, maxWaitMs: 1000 })
    c.add('a')
    c.flush()
    expect(run).toHaveBeenCalledWith(['a'])
    c.add('b')
    c.cancel()
    vi.runAllTimers()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
