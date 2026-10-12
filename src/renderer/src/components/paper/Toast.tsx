import { useEffect, useState } from 'react'
import { useT } from '@renderer/lib/i18n'
import { useToast, type Toast } from '@renderer/stores/toast'

/** Augen nur bei Eulen-Ursprung — und nie beim Countdown (Rec-Punkt gewinnt). */
// eslint-disable-next-line react-refresh/only-export-components -- Reine Hilfsfunktion, von Tests und Toast-Komponente gemeinsam genutzt
export function showOwlEyes(toast: Pick<Toast, 'owl' | 'countdown'>): boolean {
  return Boolean(toast.owl) && !toast.countdown
}

/**
 * Die eine Toast-Leiste (Design 1c): Ink-Balken unten mittig, vier Varianten.
 * Countdown bekommt pulsierenden Rec-Punkt und eine 2px-Progress-Schiene,
 * Fehler einen Akzent-Rahmen und bleiben bis zum Schließen stehen.
 */
export function ToastHost(): React.JSX.Element | null {
  const current = useToast((s) => s.current)
  const runAction = useToast((s) => s.runAction)
  const dismiss = useToast((s) => s.dismiss)
  const t = useT()
  const [clock, setClock] = useState(0)

  const isCountdown = Boolean(current?.countdown)

  // Tick nur fürs Zifferblatt und die Schiene des Countdowns (rein visuell —
  // den Auto-Swap am Ende übernimmt der Store-Timer).
  useEffect(() => {
    if (!isCountdown) return
    const iv = setInterval(() => setClock(Date.now()), 200)
    return () => clearInterval(iv)
  }, [isCountdown])

  if (!current) return null

  // Beim ersten Render eines Countdowns ist die Uhr noch nicht getickt —
  // dann ist createdAt (gerade eben) die genaueste Zeitquelle.
  const now = Math.max(clock, current.createdAt)
  const cd = current.countdown
  const secondsLeft = cd ? Math.max(0, Math.ceil((cd.until - now) / 1000)) : 0
  const text = cd ? cd.textFor(secondsLeft) : current.text
  const total = cd ? Math.max(1, cd.until - current.createdAt) : 1
  const remaining = cd ? Math.min(1, Math.max(0, (cd.until - now) / total)) : 0
  const showDismiss = current.kind === 'error' || current.dismiss === true

  return (
    <div className="toast-host" role={current.kind === 'error' ? 'alert' : 'status'}>
      <div className="toast-bar" data-kind={current.kind}>
        <div
          className="toast-bar__row"
          data-buttons={current.action || showDismiss ? '' : undefined}
        >
          {showOwlEyes(current) ? (
            // Eulen-Ursprung: zwei Akzent-Augen statt Quadrat — der Rec-Punkt
            // des Countdowns hat immer Vorrang.
            <span className="toast-bar__eyes" aria-hidden="true">
              <span />
              <span />
            </span>
          ) : (
            <span className="toast-bar__dot" data-rec={cd ? '' : undefined} aria-hidden="true" />
          )}
          <span className="toast-bar__text">{text}</span>
          {current.action && (
            <button type="button" className="toast-btn" onClick={() => runAction(current.id)}>
              {current.action.label}
              {current.action.kbd && <span className="toast-btn__kbd">{current.action.kbd}</span>}
            </button>
          )}
          {showDismiss && (
            <button
              type="button"
              className="toast-btn toast-btn--ghost"
              onClick={() => dismiss(current.id)}
            >
              {t('toastDismiss')}
            </button>
          )}
        </div>
        {cd && (
          <div className="toast-bar__rail" aria-hidden="true">
            <span style={{ width: `${remaining * 100}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}
