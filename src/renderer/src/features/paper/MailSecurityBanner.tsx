import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useT } from '@renderer/lib/i18n'
import { invoke, onPush } from '@renderer/lib/ipc'
import { bannerKind, parseSignal } from '@renderer/features/paper/phishing-signals'
import { useMailSecurity } from '@renderer/queries/intel'
import { usePaper } from '@renderer/stores/paper'
import type { StringKey } from '@renderer/i18n/strings'

/**
 * Spam/phishing notice in the mail view. Based on local rules (homoglyphs,
 * link deception, attachments, SPF/DMARC …) and – if set up – the local
 * decision model. If the rules flag something and a model verdict is still
 * missing, the model checks once more. Nothing is blocked; in the inbox
 * there is a „In den Spam-Ordner" button.
 */

const TITLE: Record<NonNullable<ReturnType<typeof bannerKind>>, StringKey> = {
  'phishing-high': 'phishingBanner',
  'phishing-suspicious': 'phishingSuspiciousBanner',
  'spam-high': 'spamBanner',
  'spam-suspicious': 'spamSuspiciousBanner'
}

export function MailSecurityBanner({ messageId }: { messageId: number }): React.JSX.Element | null {
  const t = useT()
  const queryClient = useQueryClient()
  const mbox = usePaper((s) => s.mbox)
  const query = useMailSecurity(messageId)
  const security = query.data?.security ?? null
  const checked = useRef<number | null>(null)

  // Triage finished in the background → load the new model verdict
  useEffect(
    () =>
      onPush('ai:annotated', ({ messageIds }) => {
        if (messageIds.includes(messageId)) {
          void queryClient.invalidateQueries({ queryKey: ['security', messageId] })
        }
      }),
    [queryClient, messageId]
  )

  // Rules fire, model hasn't judged yet → have it re-check once
  const flagged =
    !!security && (security.phishing.level !== 'none' || security.spam.level !== 'none')
  useEffect(() => {
    if (!security?.canCheck || !flagged || checked.current === messageId) return
    checked.current = messageId
    void invoke('security:check', { messageId })
      .then((r) => queryClient.setQueryData(['security', messageId], r))
      .catch(() => {
        // Model unreachable: the rule verdict stands
      })
  }, [security?.canCheck, flagged, messageId, queryClient])

  if (!security) return null
  const kind = bannerKind(security)
  if (!kind) return null
  const high = kind.endsWith('high')
  const reasons = security.signals.map(parseSignal).filter((r) => r !== null)
  return (
    <div
      role={high ? 'alert' : 'status'}
      data-security-banner={kind}
      style={{
        border: `1px solid ${high ? 'var(--ac)' : 'var(--hairline)'}`,
        borderLeftWidth: 3,
        borderLeftColor: high ? 'var(--ac)' : 'var(--muted)',
        background: 'var(--card-tint)',
        padding: '10px 14px',
        margin: '12px 0'
      }}
    >
      <div style={{ font: '600 13.5px/1.45 var(--serif)', color: 'var(--ink)' }}>
        {t(TITLE[kind])}
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
      <div className="flex items-center gap-3" style={{ marginTop: 8 }}>
        {mbox === 'inbox' && !security.inJunk && (
          <button
            type="button"
            className="btn-bare"
            style={{
              font: '500 10.5px var(--mono)',
              color: 'var(--ink)',
              textDecoration: 'underline'
            }}
            onClick={() => window.dispatchEvent(new CustomEvent('paper:mail', { detail: 'spam' }))}
          >
            {t('securityMoveToJunk')}
          </button>
        )}
        <span style={{ font: '400 9.5px var(--mono)', color: 'var(--faint)' }}>
          {t(security.model ? 'phishingNote' : 'securityRulesNote')}
        </span>
      </div>
    </div>
  )
}
