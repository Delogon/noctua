/**
 * Column widths (folders, list, owl rail): dragged by the user and
 * collapsible. If the sum doesn't fit the window, the columns first shrink
 * to their minimum, then collapse automatically — the email itself always
 * keeps MIN_CONTENT of space. Pure function, so it is testable.
 */

export type PaneId = 'folders' | 'list' | 'rail'

export const PANE_LIMITS: Record<PaneId, { min: number; max: number; default: number }> = {
  folders: { min: 170, max: 420, default: 236 },
  list: { min: 280, max: 680, default: 400 },
  rail: { min: 240, max: 520, default: 290 }
}

/** Width of a collapsed column (rail with expand button). */
export const STRIP_WIDTH = 28
/** Minimum width of the email sheet including margin. */
export const MIN_CONTENT = 520

/** Order for shrinking/collapsing: first the owl, then folders, the list last. */
const SQUEEZE_ORDER: PaneId[] = ['rail', 'folders', 'list']

export function clampPaneWidth(id: PaneId, width: number): number {
  const { min, max } = PANE_LIMITS[id]
  return Math.round(Math.min(max, Math.max(min, width)))
}

export interface PaneInput {
  id: PaneId
  /** Expanded by the user. */
  open: boolean
  width: number
}

export interface PaneOutput {
  /** Shown as a full column (otherwise as a rail). */
  visible: boolean
  width: number
  /** Collapsed only for lack of space — the user left it open. */
  autoCollapsed: boolean
}

export function layoutPanes(
  panes: PaneInput[],
  available: number,
  /** Columns the user wants open despite lack of space (click on the rail). */
  pinned: ReadonlySet<PaneId> = new Set()
): Record<PaneId, PaneOutput> {
  const out = {} as Record<PaneId, PaneOutput>
  for (const p of panes) {
    out[p.id] = { visible: p.open, width: clampPaneWidth(p.id, p.width), autoCollapsed: false }
  }
  const budget = (): number => {
    let used = MIN_CONTENT
    for (const p of panes) used += out[p.id].visible ? out[p.id].width : STRIP_WIDTH
    return available - used
  }

  const order = SQUEEZE_ORDER.filter((id) => out[id] !== undefined)
  // 1. Shrink down to the minimum
  for (const id of order) {
    const over = -budget()
    if (over <= 0) return out
    if (!out[id].visible) continue
    out[id].width = Math.max(PANE_LIMITS[id].min, out[id].width - over)
  }
  // 2. Collapse (finally; pinned columns never)
  for (const id of order) {
    if (budget() >= 0) return out
    if (!out[id].visible || pinned.has(id)) continue
    out[id] = { visible: false, width: out[id].width, autoCollapsed: true }
    // Give freed-up space back to the remaining columns
    for (const other of order) {
      if (!out[other].visible) continue
      const wanted = clampPaneWidth(other, panes.find((p) => p.id === other)!.width)
      out[other].width = Math.min(wanted, out[other].width + Math.max(0, budget()))
    }
  }
  return out
}
