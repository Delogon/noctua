import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { useTaskAssignments } from '@renderer/queries/intel'

interface DraftedRule {
  name: string
  description: string
  ruleJson: string
}

/** Regel-JSON lesbar formatieren — bei kaputtem JSON den Rohtext zeigen. */
function prettyRuleJson(ruleJson: string): string {
  try {
    return JSON.stringify(JSON.parse(ruleJson), null, 2)
  } catch {
    return ruleJson
  }
}

/**
 * NL-Regeln: Nutzer beschreibt, die Eule schlägt eine deterministische Regel
 * vor. Letterpress-Fassung (Design 3c) — menschliche Beschreibung zuerst,
 * das JSON hinter einer Disclosure; Zeilen im Toggle-Track-Vokabular.
 */
export function RulesSection(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const rules = useQuery({
    queryKey: ['rules'],
    queryFn: () => invoke('rules:list', undefined),
    select: (d) => d.rules
  })
  // KI-Bedingungen brauchen ein Entscheidungsmodell – ohne es werden solche Regeln übersprungen
  const decisionReady = useTaskAssignments().data?.decision.blocked === null
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<DraftedRule | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const draftMut = useMutation({
    mutationFn: (t2: string) => invoke('rules:draft', { text: t2 }),
    onSuccess: (d) => {
      setDraft(d)
      setShowJson(false)
      setError(null)
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e))
  })
  const saveMut = useMutation({
    mutationFn: (d: DraftedRule) =>
      invoke('rules:save', {
        name: d.name,
        description: d.description,
        sourceText: text,
        ruleJson: d.ruleJson
      }),
    onSuccess: () => {
      setDraft(null)
      setText('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['rules'] })
    },
    onError: (e) => setError(e instanceof Error ? e.message : String(e))
  })
  const toggleMut = useMutation({
    mutationFn: (v: { id: number; enabled: boolean }) => invoke('rules:toggle', v),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['rules'] })
  })
  const deleteMut = useMutation({
    mutationFn: (id: number) => invoke('rules:delete', { id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['rules'] })
  })

  const list = rules.data ?? []

  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('rulesHead')}
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>{t('rulesSub')}</span>
      </div>

      {/* Beschreiben → Entwerfen: Eingabe + DRAFT-Taste (↵ im Feld tut dasselbe) */}
      <div className="flex gap-2" style={{ marginTop: 10 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && text.trim() && !draftMut.isPending) {
              draftMut.mutate(text.trim())
            }
          }}
          placeholder={t('rulesPlaceholder')}
          className="paper-input"
          style={{ width: 'auto', flex: 1 }}
        />
        <button
          type="button"
          onClick={() => draftMut.mutate(text.trim())}
          disabled={!text.trim() || draftMut.isPending}
          className="ink-btn flex-none"
          style={{ font: '500 10px var(--mono)', letterSpacing: 1, padding: '8px 14px' }}
        >
          {draftMut.isPending ? t('rulesDrafting') : t('rulesDraftBtn')}
        </button>
      </div>
      {error && (
        <p style={{ font: '400 9.5px var(--mono)', color: 'var(--ac)', marginTop: 8 }}>{error}</p>
      )}

      {/* Der Entwurf: menschliche Beschreibung zuerst, JSON hinter der Disclosure */}
      {draft && (
        <div
          style={{
            background: 'var(--sheet)',
            border: '1px solid var(--hairline)',
            padding: '12px 14px',
            marginTop: 12
          }}
        >
          <div style={{ font: '600 13.5px var(--serif)' }}>{draft.name}</div>
          <div
            style={{
              font: 'italic 400 12.5px/1.5 var(--serif)',
              color: 'var(--secondary)',
              marginTop: 4
            }}
          >
            {draft.description}
          </div>
          <button
            type="button"
            className="btn-bare"
            aria-expanded={showJson}
            onClick={() => setShowJson((v) => !v)}
            style={{
              font: '500 8.5px var(--mono)',
              letterSpacing: 1,
              color: 'var(--muted)',
              marginTop: 9,
              display: 'block'
            }}
          >
            {showJson ? t('rulesHideJson') : t('rulesShowJson')}
          </button>
          {showJson && (
            <pre
              style={{
                border: '1px solid var(--hairline-light)',
                background: 'var(--card-tint)',
                padding: '8px 10px',
                font: '400 10px/1.5 var(--mono)',
                color: 'var(--secondary)',
                maxHeight: 160,
                overflow: 'auto',
                margin: '8px 0 0'
              }}
            >
              {prettyRuleJson(draft.ruleJson)}
            </pre>
          )}
          <div className="flex gap-2" style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => saveMut.mutate(draft)}
              disabled={saveMut.isPending}
              className="ink-btn"
              style={{ padding: '5px 12px' }}
            >
              {t('rulesActivate')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null)
                setError(null)
              }}
              className="ghost-btn"
              style={{ padding: '5px 10px' }}
            >
              {t('rulesDiscard')}
            </button>
          </div>
        </div>
      )}

      {/* Bestehende Regeln: Toggle-Track + Listenzeilen, Treffer als Outline-Chip */}
      <div style={{ borderTop: '1px solid var(--hairline)', marginTop: 12 }}>
        {list.map((rule, index) => (
          <div
            key={rule.id}
            className="flex items-center gap-2.5"
            style={{
              padding: '9px 2px',
              borderBottom: index < list.length - 1 ? '1px solid var(--hairline-light)' : 'none'
            }}
          >
            <button
              type="button"
              onClick={() => toggleMut.mutate({ id: rule.id, enabled: !rule.enabled })}
              className="toggle-track flex-none"
              aria-pressed={rule.enabled}
              title={rule.enabled ? t('rulesActive') : t('rulesInactive')}
              style={{ background: rule.enabled ? 'var(--ink)' : 'transparent', cursor: 'pointer' }}
            >
              <span
                className="toggle-dot"
                style={{
                  background: rule.enabled ? '#F4F1EA' : 'var(--ink)',
                  marginLeft: rule.enabled ? 12 : 0
                }}
              />
            </button>
            <span
              title={rule.description ?? undefined}
              style={{
                font: '400 13px var(--serif)',
                color: rule.enabled ? 'var(--ink)' : 'var(--secondary)',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {rule.name}
            </span>
            {rule.aiCondition && (
              <span
                className="mchip flex-none"
                title={rule.aiCondition}
                style={{
                  border: '1px solid var(--hairline)',
                  color: decisionReady ? 'var(--muted)' : 'var(--ac)'
                }}
              >
                {t('ruleAiCondition')}
              </span>
            )}
            {rule.hits > 0 && (
              <span
                className="mchip flex-none"
                title={t('rulesHits', { n: rule.hits })}
                style={{ border: '1px solid var(--hairline)', color: 'var(--muted)' }}
              >
                {rule.hits}×
              </span>
            )}
            <button
              type="button"
              onClick={() => deleteMut.mutate(rule.id)}
              className="btn-bare flex-none"
              aria-label={t('rulesDelete')}
              style={{ font: '500 10px var(--mono)', color: 'var(--faint)', padding: '4px 6px' }}
            >
              ×
            </button>
          </div>
        ))}
        {!decisionReady && list.some((r) => r.aiCondition) && (
          <p
            style={{
              font: '400 9.5px var(--mono)',
              color: 'var(--ac)',
              margin: 0,
              padding: '6px 2px 2px'
            }}
          >
            {t('ruleAiNeedsModel')}
          </p>
        )}
        {rules.data?.length === 0 && (
          <p
            style={{
              font: 'italic 400 11.5px/1.55 var(--serif)',
              color: 'var(--faint)',
              margin: 0,
              padding: '9px 2px 2px'
            }}
          >
            {t('rulesEmpty')}
          </p>
        )}
      </div>
    </div>
  )
}
