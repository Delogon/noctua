import { useEffect, useState } from 'react'
import { useT } from '@renderer/lib/i18n'
import { useToast, type Toast } from '@renderer/stores/toast'

/** Eyes only for owl origin — and never on the countdown (rec dot wins). */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper shared by tests and the toast component
export function showOwlEyes(toast: Pick<Toast, 'owl' | 'countdown'>): boolean {
  return Boolean(toast.owl) && !toast.countdown
}

/**
 * The one toast bar (Design 1c): ink bar at bottom center, four variants.
 * Countdown gets a pulsing rec dot and a 2px progress rail,
 * errors get an accent frame and stay until closed.
 */
export function ToastHost(): React.JSX.Element | null {
  const current = useToast((s) => s.current)
  const runAction = useToast((s) => s.runAction)
  const dismiss = useToast((s) => s.dismiss)
  const t = useT()
  const [clock, setClock] = useState(0)

  const isCountdown = Boolean(current?.countdown)

  // Tick only for the countdown's dial and rail (purely visual —
  // the store timer handles the auto-swap at the end).
  useEffect(() => {
    if (!isCountdown) return
    const iv = setInterval(() => setClock(Date.now()), 200)
    return () => clearInterval(iv)
  }, [isCountdown])

  if (!current) return null

  // On a countdown's first render the clock has not ticked yet —
  // then createdAt (just now) is the most accurate time source.
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
            // Owl origin: two accent eyes instead of a square — the countdown's
            // rec dot always takes precedence.
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
