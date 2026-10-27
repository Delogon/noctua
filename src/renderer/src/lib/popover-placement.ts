import { useLayoutEffect, useRef } from 'react'

/**
 * Automatic popover alignment (M83): dropdowns no longer anchor rigidly
 * via CSS (`left: 0` / `right: 0`), but measure themselves against the
 * window on open and pick the direction themselves — left-aligned if there is room
 * on the right, otherwise right-aligned, clamped to the window edge if needed; upward
 * instead of downward if there is less room below the anchor than above.
 *
 * The geometry lives in computePopoverPlacement (pure, testable); the hook
 * usePopoverPlacement writes the position directly to the element in a layout
 * effect before paint, so a mispositioned frame is never visible.
 */

export interface PlacementBox {
  left: number
  top: number
  width: number
  height: number
}

export interface PopoverPlacement {
  /** Left edge of the popover in viewport coordinates. */
  left: number
  /** Top edge of the popover in viewport coordinates. */
  top: number
  /** Clamped height when the available space is smaller than the popover. */
  maxHeight: number | null
  /** true: opens above the anchor (below there would be less room). */
  openUp: boolean
}

/** Safety margin to the window edge and gap between anchor and popover. */
const EDGE_MARGIN = 8
const ANCHOR_GAP = 4

export function computePopoverPlacement(
  anchor: PlacementBox,
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { gap?: number; margin?: number } = {}
): PopoverPlacement {
  const gap = opts.gap ?? ANCHOR_GAP
  const margin = opts.margin ?? EDGE_MARGIN

  // Horizontal: left-aligned at the anchor preferred; if that doesn't fit,
  // right-aligned; if that overflows too, clamp to the edges.
  let left = anchor.left
  if (left + popover.width > viewport.width - margin) {
    left = anchor.left + anchor.width - popover.width
  }
  left = Math.min(left, viewport.width - margin - popover.width)
  left = Math.max(margin, left)

  // Vertical: below the anchor preferred; upward only if there is more room
  // there. If the chosen side is not enough, the height is clamped (scrolls).
  const spaceBelow = viewport.height - margin - (anchor.top + anchor.height + gap)
  const spaceAbove = anchor.top - gap - margin
  const openUp = popover.height > spaceBelow && spaceAbove > spaceBelow
  const available = openUp ? spaceAbove : spaceBelow
  const maxHeight = popover.height > available ? Math.max(0, Math.floor(available)) : null
  const height = maxHeight ?? popover.height
  const top = openUp ? anchor.top - gap - height : anchor.top + anchor.height + gap

  return { left, top, maxHeight, openUp }
}

/**
 * Aligns the open popover to its anchor — the parent element, i.e.
 * the control it is rendered in. The element carries `popover="manual"`
 * and is lifted into the window's top layer: there it takes no space
 * in the scroll container (no sideways co-scrolling), is not clipped by any
 * ancestor and lies above everything. Opening/closing is still controlled by
 * the components (outside click, Esc) — the DOM position stays unchanged,
 * so `contains()` checks work as before. It is re-measured on
 * window resize, scroll and when the size of the popover content changes.
 */
export function usePopoverPlacement(open: boolean): React.RefObject<HTMLDivElement | null> {
  const popoverRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) return
    const el = popoverRef.current
    const anchor = el?.parentElement
    if (!el || !anchor) return

    // Top layer, if the Popover API is available (fallback: absolute in the control)
    const topLayer = typeof el.showPopover === 'function' && el.hasAttribute('popover')
    if (topLayer) {
      try {
        el.showPopover()
      } catch {
        // already open — doesn't matter
      }
    }

    const measure = (): void => {
      // Discard the previous clamping so the natural size is measured
      el.style.left = ''
      el.style.top = ''
      el.style.right = ''
      el.style.bottom = ''
      el.style.maxHeight = ''
      if (topLayer) {
        // Replace UA styles of the popover element (inset:0, margin:auto, padding)
        el.style.position = 'fixed'
        el.style.margin = '0'
        el.style.padding = '0'
      }

      const rect = el.getBoundingClientRect()
      const anchorRect = anchor.getBoundingClientRect()
      const placement = computePopoverPlacement(
        {
          left: anchorRect.left,
          top: anchorRect.top,
          width: anchorRect.width,
          height: anchorRect.height
        },
        { width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight }
      )

      if (topLayer) {
        // position:fixed in the top layer: left/top are directly viewport coordinates
        el.style.left = `${placement.left}px`
        el.style.top = `${placement.top}px`
      } else {
        // Viewport → CSS coordinates via the used values of the measured position
        const computed = getComputedStyle(el)
        el.style.left = `${parseFloat(computed.left) + placement.left - rect.left}px`
        el.style.top = `${parseFloat(computed.top) + placement.top - rect.top}px`
      }
      el.style.right = 'auto'
      el.style.bottom = 'auto'
      if (placement.maxHeight !== null) {
        el.style.maxHeight = `${placement.maxHeight}px`
        el.style.overflowY = 'auto'
      }
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    window.addEventListener('resize', measure)
    // capture: also catches scrolling of inner containers (list, sheet)
    window.addEventListener('scroll', measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open])

  return popoverRef
}
