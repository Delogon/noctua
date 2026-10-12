import { useEffect } from 'react'

/**
 * Closes an overlay via Escape. Capture phase + stopPropagation so that
 * underlying Escape handlers (e.g. the inbox selection reset) don't
 * fire as well while the dialog is open.
 */
export function useEscapeClose(open: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      event.preventDefault()
      onClose()
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [open, onClose])
}
