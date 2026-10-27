import { useEffect, useRef, useState } from 'react'
import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import { PANE_LIMITS, STRIP_WIDTH, type PaneId } from './pane-layout'

/**
 * Frame of a side column: fixed width from the store plus a drag handle on
 * the inner edge. Double-click, Enter or dragging far below the minimum
 * collapses the column; arrow keys change the width (handle is focusable).
 */

/** Dragged this far below the minimum, the column collapses. */
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
  /** Side of the column: left (handle on the right) or right (handle on the left). */
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

  // While dragging: text selection and iframes (mail body) must not swallow the pointer
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
      // Remember the width from before dragging so expanding restores it
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
      {/* Visible collapse button on the edge — counterpart to the rail */}
      <button
        type="button"
        className="pane-collapse"
        data-side={side}
        aria-label={t('paneCollapseAria', { name: label })}
        aria-expanded={true}
        title={t('paneCollapseAria', { name: label })}
        onClick={() => collapsePane(id)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d={side === 'left' ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5'} />
        </svg>
      </button>
    </div>
  )
}

/** Collapsed column: narrow rail, one click expands it again. */
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
  // Arrow points in the direction the column opens
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
