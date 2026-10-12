import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { clearRendererDiagnostics, rendererDiagnostics } from '@renderer/lib/diagnostics'
import { toast } from '@renderer/stores/toast'
import type { InvokeOutput } from '@shared/ipc-contract'

// Technik-Seite, Abschnitt „Leistungsdiagnose": misst lokal, wo Zeit und CPU
// hingehen (Operationen, SQL, Event-Loop), startet auf Wunsch einen Benchmark
// gegen die eigene Datenbank und exportiert alles als ZIP — nur auf Klick, nie
// automatisch. Inhalte von E-Mails sind nie Teil der Messwerte.

type Status = InvokeOutput<'diagnostics:status'>
type Benchmark = InvokeOutput<'diagnostics:benchmark'>

const mono = (size = 10.5, weight = 400): React.CSSProperties => ({
  font: `${weight} ${size}px var(--mono)`
})

function fmtMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(0)} s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`
  return `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms`
}

function Row({
  cells,
  head = false
}: {
  cells: Array<React.ReactNode>
  head?: boolean
}): React.JSX.Element {
  return (
    <div
      className="flex items-baseline gap-3"
      style={{
        padding: '4px 2px',
        borderTop: head ? 'none' : '1px solid var(--hairline)',
        color: head ? 'var(--muted)' : 'var(--ink)',
        ...mono(head ? 8.5 : 10.5, head ? 500 : 400)
      }}
    >
      <span
        className="min-w-0 flex-1"
        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {cells[0]}
      </span>
      {cells.slice(1).map((c, i) => (
        <span key={i} className="flex-none" style={{ width: 64, textAlign: 'right' }}>
          {c}
        </span>
      ))}
    </div>
  )
}

function Live({ status }: { status: Status }): React.JSX.Element | null {
  const t = useT()
  const s = status.latest
  if (!s) return null
  const items: Array<[string, string]> = [
    [
      t('diagCpu'),
      `${s.mainCpuPct.toFixed(0)} %${s.appCpuPct !== null ? ` · ${s.appCpuPct.toFixed(0)} %` : ''}`
    ],
    [
      t('diagMemory'),
      `${Math.round(s.rssMb)} MB${s.appMemMb !== null ? ` · ${Math.round(s.appMemMb)} MB` : ''}`
    ],
    [t('diagLoop'), `${fmtMs(s.loopP99Ms)} / ${fmtMs(s.loopMaxMs)}`],
    [t('diagSql'), `${s.sqlCalls} · ${fmtMs(s.sqlMs)}`]
  ]
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 8,
        marginTop: 10
      }}
    >
      {items.map(([label, value]) => (
        <div key={label} style={{ border: '1px solid var(--hairline)', padding: '6px 8px' }}>
          <div className="mlabel" style={{ color: 'var(--muted)' }}>
            {label}
          </div>
          <div style={{ ...mono(12, 500), marginTop: 2 }}>{value}</div>
        </div>
      ))}
    </div>
  )
}

function BenchmarkResult({ result }: { result: Benchmark }): React.JSX.Element {
  const t = useT()
  const scans = result.plans.filter((p) => p.fullScans.length > 0)
  return (
    <div style={{ marginTop: 10 }}>
      <Row head cells={[t('diagBenchCase'), t('diagMedian'), t('diagMax'), t('diagStatements')]} />
      {result.cases.map((c) => (
        <Row
          key={c.name}
          cells={[
            c.error ? `${c.name} — ${c.error}` : c.name,
            fmtMs(c.medianMs),
            fmtMs(c.maxMs),
            c.statements
          ]}
        />
      ))}
      <div
        style={{ ...mono(9.5), color: scans.length ? 'var(--ac)' : 'var(--muted)', marginTop: 6 }}
      >
        {t('diagFullScans', { n: scans.length, total: result.plans.length })}
      </div>
    </div>
  )
}

export function DiagnosticsPanel(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const [withBenchmark, setWithBenchmark] = useState(true)
  const query = useQuery({
    queryKey: ['diagnostics', 'status'],
    queryFn: () => invoke('diagnostics:status', undefined),
    refetchInterval: 5000,
    staleTime: 0
  })
  const status = query.data
  const refresh = (): void => void queryClient.invalidateQueries({ queryKey: ['diagnostics'] })

  const toggle = useMutation({
    mutationFn: (enabled: boolean) => invoke('diagnostics:setEnabled', { enabled }),
    onSuccess: refresh
  })
  const bench = useMutation({
    mutationFn: () => invoke('diagnostics:benchmark', undefined),
    onSuccess: refresh
  })
  const exportZip = useMutation({
    mutationFn: () =>
      invoke('diagnostics:export', { renderer: rendererDiagnostics(), withBenchmark }),
    onSuccess: (r) => {
      if (r.saved && r.fileName) toast.info(t('diagExported', { file: r.fileName }))
      refresh()
    },
    onError: () => toast.info(t('diagExportFailed'))
  })
  const clear = useMutation({
    mutationFn: () => invoke('diagnostics:clear', undefined),
    onSuccess: () => {
      clearRendererDiagnostics()
      toast.info(t('diagCleared'))
      refresh()
    }
  })

  const benchmark = bench.data ?? status?.benchmark ?? null
  const busy = bench.isPending || exportZip.isPending

  return (
    <section className="tint-card" style={{ padding: '14px 16px', minWidth: 0, marginTop: 14 }}>
      <div className="flex items-center gap-2">
        <span style={{ width: 6, height: 6, background: 'var(--ac)', flex: 'none' }} />
        <span className="mlabel" style={{ color: 'var(--ink)' }}>
          12 · {t('diagTitle')}
        </span>
        <span style={{ flex: 1, borderTop: '1px solid var(--hairline)' }} />
        {status && (
          <button
            type="button"
            className="btn-bare flex items-center gap-1.5"
            aria-pressed={status.enabled}
            onClick={() => toggle.mutate(!status.enabled)}
          >
            <span
              className="toggle-track"
              style={{ background: status.enabled ? 'var(--ink)' : 'transparent' }}
            >
              <span
                className="toggle-dot"
                style={{
                  background: status.enabled ? 'var(--paper)' : 'var(--ink)',
                  marginLeft: status.enabled ? 12 : 0
                }}
              />
            </span>
            <span style={mono(9.5)}>{t('diagToggle')}</span>
          </button>
        )}
      </div>

      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--secondary)',
          marginTop: 8
        }}
      >
        {t('diagCap')}
      </div>

      {status && <Live status={status} />}

      {status && status.topOperations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Row
            head
            cells={[t('diagOperation'), t('diagCalls'), 'p95', t('diagMax'), t('diagTotal')]}
          />
          {status.topOperations.map((op) => (
            <Row
              key={op.name}
              cells={[op.name, op.count, fmtMs(op.p95Ms), fmtMs(op.maxMs), fmtMs(op.totalMs)]}
            />
          ))}
        </div>
      )}

      {status && status.slow.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Row head cells={[t('diagSlowest'), t('diagDuration')]} />
          {status.slow.map((s) => (
            <Row key={`${s.name}-${s.at}`} cells={[s.name, fmtMs(s.ms)]} />
          ))}
        </div>
      )}

      {benchmark && <BenchmarkResult result={benchmark} />}

      <div className="flex flex-wrap items-center gap-3" style={{ marginTop: 14 }}>
        <button
          type="button"
          className="btn-primary"
          disabled={busy}
          onClick={() => exportZip.mutate()}
        >
          {exportZip.isPending ? t('diagExporting') : t('diagExport')}
        </button>
        <label className="flex items-center gap-1.5" style={mono(9.5)}>
          <input
            type="checkbox"
            checked={withBenchmark}
            onChange={(e) => setWithBenchmark(e.target.checked)}
          />
          {t('diagWithBenchmark')}
        </label>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => bench.mutate()}>
          {bench.isPending ? t('diagBenchRunning') : t('diagBenchRun')}
        </button>
        <button
          type="button"
          className="btn-bare"
          disabled={busy}
          onClick={() => clear.mutate()}
          style={{ ...mono(10), color: 'var(--muted)' }}
        >
          {t('diagClear')}
        </button>
        {status && (
          <span style={{ ...mono(9), color: 'var(--faint)' }}>
            {t('diagStored', { n: status.storedSessions, samples: status.sampleCount })}
          </span>
        )}
      </div>
    </section>
  )
}
