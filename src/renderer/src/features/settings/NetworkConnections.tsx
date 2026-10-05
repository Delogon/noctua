import { useQuery } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import type { StringKey } from '@renderer/i18n/strings'
import type { NetworkConnection } from '@shared/types'

// Technik-Seite, Abschnitt „Netzwerkverbindungen": die tatsächlichen Ziele der
// App, live aus Konten, KI-Profilen, Update-Quelle und Local only berechnet
// (Main: privacy:networkConnections) — keine handgepflegte Behauptung.

const KIND_LABEL: Record<NetworkConnection['kind'], StringKey> = {
  mail: 'techNetKindMail',
  oauth: 'techNetKindOauth',
  ai: 'techNetKindAi',
  updates: 'techNetKindUpdates',
  embeddings: 'techNetKindEmbeddings'
}

const STATUS_LABEL: Record<NetworkConnection['status'], StringKey> = {
  active: 'techNetActive',
  blocked: 'techNetBlocked',
  'manual-only': 'techNetManual',
  'on-demand': 'techNetOnDemand',
  cached: 'techNetCached',
  off: 'techNetOff'
}

const TASK_LABEL: Record<NetworkConnection['tasks'][number], StringKey> = {
  triage: 'techNetTaskTriage',
  draft: 'techNetTaskDraft',
  stt: 'techNetTaskStt'
}

export function NetworkConnections(): React.JSX.Element {
  const t = useT()
  const query = useQuery({
    queryKey: ['privacy', 'network'],
    queryFn: () => invoke('privacy:networkConnections', undefined),
    staleTime: 0
  })
  const data = query.data

  return (
    <section className="tint-card" style={{ padding: '14px 16px', minWidth: 0, marginTop: 14 }}>
      <div className="flex items-center gap-2">
        <span style={{ width: 6, height: 6, background: 'var(--ac)', flex: 'none' }} />
        <span className="mlabel" style={{ color: 'var(--ink)' }}>
          11 · {t('techNetTitle')}
        </span>
        <span style={{ flex: 1, borderTop: '1px solid var(--hairline)' }} />
        {data && (
          <span className="mlabel" style={{ color: data.localOnly ? 'var(--ac)' : 'var(--muted)' }}>
            {data.localOnly ? t('techNetLocalOnlyOn') : t('techNetLocalOnlyOff')}
          </span>
        )}
      </div>
      <div className="flex flex-col" style={{ marginTop: 10 }}>
        {(data?.connections ?? []).map((c, i) => {
          const dim = c.status === 'blocked' || c.status === 'off'
          return (
            <div
              key={`${c.kind}-${c.label}-${c.host}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5"
              style={{
                padding: '6px 2px',
                borderTop: i === 0 ? 'none' : '1px solid var(--hairline)',
                opacity: dim ? 0.6 : 1
              }}
            >
              <span
                className="flex-none"
                style={{ font: '500 8.5px var(--mono)', letterSpacing: 1, width: 118 }}
              >
                {t(KIND_LABEL[c.kind])}
              </span>
              <span className="min-w-0 flex-1" style={{ font: '400 11px var(--mono)' }}>
                {c.label && <span>{c.label} · </span>}
                <span style={{ color: 'var(--muted)' }}>{c.host ?? '—'}</span>
                {c.tasks.length > 0 && (
                  <span style={{ color: 'var(--faint)' }}>
                    {' '}
                    · {c.tasks.map((task) => t(TASK_LABEL[task])).join(' / ')}
                  </span>
                )}
              </span>
              <span
                className="flex-none"
                style={{
                  font: '500 8.5px var(--mono)',
                  letterSpacing: 0.6,
                  color: c.scope === 'local' ? 'var(--ac)' : 'var(--muted)'
                }}
              >
                {c.scope === 'local' ? t('techNetLocal') : t('techNetExternal')}
              </span>
              <span
                className="flex-none"
                style={{ font: '500 8.5px var(--mono)', letterSpacing: 0.6, width: 96 }}
              >
                {t(STATUS_LABEL[c.status])}
              </span>
            </div>
          )
        })}
      </div>
      <div
        style={{
          font: '400 11.5px/1.6 var(--serif)',
          fontStyle: 'italic',
          color: 'var(--secondary)',
          marginTop: 10
        }}
      >
        {t('techNetCap')}
      </div>
    </section>
  )
}
