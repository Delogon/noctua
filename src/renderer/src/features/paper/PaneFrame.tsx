import { useEffect, useRef, useState } from 'react'
import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import { PANE_LIMITS, STRIP_WIDTH, type PaneId } from './pane-layout'

/**
 * Rahmen einer Seitenspalte: feste Breite aus dem Store plus Zieh-Griff an der
 * Innenkante. Doppelklick, Enter oder Ziehen weit unter das Minimum klappt die
 * Spalte ein; Pfeiltasten ändern die Breite (Griff ist fokussierbar).
 */

/** So weit unter das Minimum gezogen, klappt die Spalte ein. */
const COLLAPSE_DRAG = 90
const KEY_STEP = 16

export function ResizablePane({
  id,
  side,
  width,
  label,
  children
}: {
  id: PaneId
  /** Lage der Spalte: links (Griff rechts) oder rechts (Griff links). */
  side: 'left' | 'right'
  width: number
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  const t = useT()
  const setPaneWidth = usePaper((s) => s.setPaneWidth)
  const collapsePane = usePaper((s) => s.collapsePane)
  const storedWidth = usePaper((s) => s.paneWidths[id])
  const drag = useRef<{ x: number; w: number; last: number } | null>(null)
  const [dragging, setDragging] = useState(false)

  // Während des Ziehens: Textauswahl und iframes (Mail-Body) dürfen den Zeiger nicht schlucken
  useEffect(() => {
    if (!dragging) return
    document.body.classList.add('pane-resizing')
    return () => document.body.classList.remove('pane-resizing')
  }, [dragging])

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, w: width, last: width }
    setDragging(true)
  }
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const next = drag.current.w + (side === 'left' ? dx : -dx)
    drag.current.last = next
    setPaneWidth(id, next)
  }
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    const { last, w } = drag.current
    drag.current = null
    setDragging(false)
    if (last < PANE_LIMITS[id].min - COLLAPSE_DRAG) {
      // Breite von vor dem Ziehen merken, damit Aufklappen sie wiederherstellt
      setPaneWidth(id, w, true)
      collapsePane(id)
    } else setPaneWidth(id, last, true)
  }
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const grow = (e.key === 'ArrowRight') === (side === 'left')
      setPaneWidth(id, storedWidth + (grow ? KEY_STEP : -KEY_STEP), true)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      collapsePane(id)
    }
  }

  return (
    <div className="pane" data-side={side} style={{ width }}>
      {children}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('paneResizeAria', { name: label })}
        aria-valuemin={PANE_LIMITS[id].min}
        aria-valuemax={PANE_LIMITS[id].max}
        aria-valuenow={Math.round(width)}
        tabIndex={0}
        title={t('paneResizeTip')}
        className="pane-handle"
        data-side={side}
        data-dragging={dragging}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => collapsePane(id)}
        onKeyDown={onKeyDown}
      />
    </div>
  )
}

/** Eingeklappte Spalte: schmale Leiste, ein Klick klappt sie wieder auf. */
export function PaneStrip({
  id,
  side,
  label,
  autoCollapsed
}: {
  id: PaneId
  side: 'left' | 'right'
  label: string
  autoCollapsed: boolean
}): React.JSX.Element {
  const t = useT()
  const expandPane = usePaper((s) => s.expandPane)
  // Pfeil zeigt in die Richtung, in die die Spalte aufgeht
  const opensRight = side === 'left'
  return (
    <button
      type="button"
      className="pane-strip"
      data-side={side}
      style={{ width: STRIP_WIDTH }}
      aria-label={t('paneExpandAria', { name: label })}
      aria-expanded={false}
      title={autoCollapsed ? t('paneAutoCollapsedTip') : t('paneExpandAria', { name: label })}
      onClick={() => expandPane(id, autoCollapsed)}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d={opensRight ? 'M6 3.5 10.5 8 6 12.5' : 'M10 3.5 5.5 8l4.5 4.5'} />
      </svg>
      <span className="pane-strip__label">{label}</span>
    </button>
  )
}
