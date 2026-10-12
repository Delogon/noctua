import { useT } from '@renderer/lib/i18n'
import { parseSignal } from '@renderer/features/paper/phishing-signals'
import { usePhishing } from '@renderer/queries/intel'

/**
 * Phishing-Warnung: erscheint nur, wenn das lokale Entscheidungsmodell die Mail
 * hoch einstuft (Score ≥ 1,4 von 2, siehe PHISHING_SCORE_HIGH). Es wird nichts
 * verschoben oder blockiert – nur ein deutlicher Hinweis, ohne Textgenerierung.
 */

export function PhishingBanner({ messageId }: { messageId: number }): React.JSX.Element | null {
  const t = useT()
  const query = usePhishing(messageId)
  const phishing = query.data?.phishing
  if (!phishing?.high) return null
  const reasons = phishing.signals.map(parseSignal).filter((r) => r !== null)
  return (
    <div
      role="alert"
      data-phishing-banner
      style={{
        border: '1px solid var(--ac)',
        borderLeftWidth: 3,
        background: 'var(--card-tint)',
        padding: '10px 14px',
        margin: '12px 0'
      }}
    >
      <div style={{ font: '600 13.5px/1.45 var(--serif)', color: 'var(--ink)' }}>
        {t('phishingBanner')}
      </div>
      {reasons.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <span className="mlabel" style={{ color: 'var(--muted)' }}>
            {t('phishingSignals')}
          </span>
          <ul
            style={{
              margin: '4px 0 0',
              paddingLeft: 16,
              font: '400 12px/1.5 var(--serif)',
              color: 'var(--secondary)'
            }}
          >
            {reasons.map((r) => (
              <li key={r.key}>{t(r.key, { n: r.n })}</li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)', marginTop: 6 }}>
        {t('phishingNote')}
      </div>
    </div>
  )
}
