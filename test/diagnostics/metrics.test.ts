import { describe, expect, it } from 'vitest'
import { Metrics, sqlFingerprint } from '@main/diagnostics/metrics'
import { percentile, emptyHistogram, observe } from '@shared/histogram'

describe('Diagnose-Metriken', () => {
  it('Laufzeiten: Anzahl, Summe, Maximum, Perzentile aus Eimern', () => {
    const m = new Metrics()
    for (let i = 0; i < 98; i++) m.record('ipc.threads:list', 3)
    m.record('ipc.threads:list', 400)
    m.record('ipc.threads:list', 1200)
    const t = m.snapshot().timings.find((x) => x.name === 'ipc.threads:list')!
    expect(t.count).toBe(100)
    expect(t.maxMs).toBe(1200)
    expect(t.p50Ms).toBe(5) // Eimer bis 5 ms
    expect(t.p99Ms).toBe(500)
    expect(t.totalMs).toBeCloseTo(98 * 3 + 1600)
  })

  it('Perzentil wird durch das Maximum gedeckelt', () => {
    const h = emptyHistogram()
    observe(h, 3.2)
    expect(percentile(h, 0.5)).toBe(3.2)
    expect(percentile(emptyHistogram(), 0.5)).toBe(0)
  })

  it('Slow-Log: nur ab Schwelle, Zusatzdaten nur Zahlen/Wahrheitswerte', () => {
    const m = new Metrics()
    m.record('fast', 5)
    m.record('sync.folder', 250, {
      messages: 40,
      backfill: true,
      // Strings (z. B. ein Betreff) dürfen nie in den Export
      subject: 'Geheim' as unknown as number,
      'bad key': 1
    })
    const slow = m.snapshot().slow
    expect(slow).toHaveLength(1)
    expect(slow[0]).toMatchObject({ name: 'sync.folder', meta: { messages: 40, backfill: true } })
    expect(JSON.stringify(slow)).not.toContain('Geheim')
  })

  it('time/timeAsync messen auch bei Fehlern; deaktiviert misst nichts', async () => {
    const m = new Metrics()
    expect(() =>
      m.time('boom', () => {
        throw new Error('x')
      })
    ).toThrow('x')
    await m.timeAsync('later', async () => 1)
    expect(
      m
        .snapshot()
        .timings.map((t) => t.name)
        .sort()
    ).toEqual(['boom', 'later'])
    m.enabled = false
    m.record('off', 1)
    m.count('off')
    expect(m.snapshot().timings.find((t) => t.name === 'off')).toBeUndefined()
    expect(m.snapshot().counters.off).toBeUndefined()
  })

  it('SQL-Fingerabdruck: keine Literale, Platzhalterlisten zusammengefasst', () => {
    expect(
      sqlFingerprint(`SELECT * FROM messages
        WHERE subject = 'Rechnung März' AND id IN (?, ?, ?) LIMIT 50`)
    ).toBe('SELECT * FROM messages WHERE subject = ? AND id IN (?…) LIMIT ?')
    expect(sqlFingerprint('SELECT 1 -- kommentar\nFROM t WHERE a IN (?,?)')).toBe(
      'SELECT ? FROM t WHERE a IN (?…)'
    )
    expect(sqlFingerprint("SELECT 'it''s'")).toBe('SELECT ?')
  })

  it('Summen für die Zeitreihe zählen SQL und IPC', () => {
    const m = new Metrics()
    m.sqlPrepare('SELECT ?', 0.5)
    m.sqlExec('SELECT ?', 2, 1)
    m.record('ipc.a', 3)
    m.record('sync.b', 7)
    expect(m.totals()).toEqual({ sqlCalls: 1, sqlMs: 2.5, ipcCalls: 1, ipcMs: 3 })
  })
})
