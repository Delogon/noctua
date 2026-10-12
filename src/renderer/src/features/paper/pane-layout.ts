/**
 * Spaltenbreiten (Ordner, Liste, Eulen-Leiste): vom Nutzer gezogen und
 * ein-/ausklappbar. Passt die Summe nicht ins Fenster, schrumpfen die Spalten
 * zuerst bis zum Minimum, dann klappen sie automatisch ein — die E-Mail selbst
 * behält immer MIN_CONTENT Platz. Reine Funktion, damit testbar.
 */

export type PaneId = 'folders' | 'list' | 'rail'

export const PANE_LIMITS: Record<PaneId, { min: number; max: number; default: number }> = {
  folders: { min: 170, max: 420, default: 236 },
  list: { min: 280, max: 680, default: 400 },
  rail: { min: 240, max: 520, default: 290 }
}

/** Breite einer eingeklappten Spalte (Leiste mit Aufklapp-Knopf). */
export const STRIP_WIDTH = 28
/** Mindestbreite des E-Mail-Blatts samt Rand. */
export const MIN_CONTENT = 520

/** Reihenfolge beim Schrumpfen/Einklappen: zuerst die Eule, dann Ordner, zuletzt die Liste. */
const SQUEEZE_ORDER: PaneId[] = ['rail', 'folders', 'list']

export function clampPaneWidth(id: PaneId, width: number): number {
  const { min, max } = PANE_LIMITS[id]
  return Math.round(Math.min(max, Math.max(min, width)))
}

export interface PaneInput {
  id: PaneId
  /** Vom Nutzer aufgeklappt. */
  open: boolean
  width: number
}

export interface PaneOutput {
  /** Wird als volle Spalte gezeigt (sonst als Leiste). */
  visible: boolean
  width: number
  /** Nur wegen Platzmangel eingeklappt — der Nutzer hat sie offen gelassen. */
  autoCollapsed: boolean
}

export function layoutPanes(
  panes: PaneInput[],
  available: number,
  /** Spalten, die der Nutzer trotz Platzmangel offen haben will (Klick auf die Leiste). */
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
  // 1. Schrumpfen bis zum Minimum
  for (const id of order) {
    const over = -budget()
    if (over <= 0) return out
    if (!out[id].visible) continue
    out[id].width = Math.max(PANE_LIMITS[id].min, out[id].width - over)
  }
  // 2. Einklappen (gepinnte Spalten zuletzt nie)
  for (const id of order) {
    if (budget() >= 0) return out
    if (!out[id].visible || pinned.has(id)) continue
    out[id] = { visible: false, width: out[id].width, autoCollapsed: true }
    // Frei gewordenen Platz an die verbliebenen Spalten zurückgeben
    for (const other of order) {
      if (!out[other].visible) continue
      const wanted = clampPaneWidth(other, panes.find((p) => p.id === other)!.width)
      out[other].width = Math.min(wanted, out[other].width + Math.max(0, budget()))
    }
  }
  return out
}
