import { describe, expect, it } from 'vitest'
import {
  MIN_CONTENT,
  PANE_LIMITS,
  STRIP_WIDTH,
  clampPaneWidth,
  layoutPanes,
  type PaneInput
} from '@renderer/features/paper/pane-layout'

const panes = (folders: number, list: number, rail: number): PaneInput[] => [
  { id: 'folders' as const, open: true, width: folders },
  { id: 'list' as const, open: true, width: list },
  { id: 'rail' as const, open: true, width: rail }
]

describe('layoutPanes', () => {
  it('lässt Breiten unverändert, wenn alles passt', () => {
    const out = layoutPanes(panes(236, 400, 290), 2000)
    expect([out.folders.width, out.list.width, out.rail.width]).toEqual([236, 400, 290])
    expect(out.rail.visible).toBe(true)
  })

  it('schrumpft zuerst die Eule, bevor etwas einklappt', () => {
    const out = layoutPanes(panes(236, 400, 290), 236 + 400 + 250 + MIN_CONTENT)
    expect(out.rail).toMatchObject({ visible: true, width: 250, autoCollapsed: false })
  })

  it('klappt bei engem Fenster die Eule, dann die Ordner automatisch ein', () => {
    const narrow = layoutPanes(panes(236, 400, 290), 1100)
    expect(narrow.rail).toMatchObject({ visible: false, autoCollapsed: true })
    expect(narrow.folders.visible).toBe(true)

    const tiny = layoutPanes(panes(236, 400, 290), 900)
    expect(tiny.folders).toMatchObject({ visible: false, autoCollapsed: true })
    expect(tiny.list.visible).toBe(true)
    // The email keeps its minimum width
    expect(tiny.list.width + 2 * STRIP_WIDTH + MIN_CONTENT).toBeLessThanOrEqual(900)
  })

  it('gepinnte Spalten bleiben offen, andere weichen', () => {
    const out = layoutPanes(panes(236, 400, 290), 1100, new Set(['rail']))
    expect(out.rail.visible).toBe(true)
    expect(out.folders).toMatchObject({ visible: false, autoCollapsed: true })
  })

  it('vom Nutzer eingeklappte Spalten zählen nur als Leiste', () => {
    const out = layoutPanes(
      [
        { id: 'list', open: true, width: 400 },
        { id: 'rail', open: false, width: 290 }
      ],
      400 + STRIP_WIDTH + MIN_CONTENT
    )
    expect(out.rail).toMatchObject({ visible: false, autoCollapsed: false })
    expect(out.list.width).toBe(400)
  })
})

describe('clampPaneWidth', () => {
  it('hält Grenzen ein', () => {
    expect(clampPaneWidth('list', 10)).toBe(PANE_LIMITS.list.min)
    expect(clampPaneWidth('list', 9999)).toBe(PANE_LIMITS.list.max)
  })
})
