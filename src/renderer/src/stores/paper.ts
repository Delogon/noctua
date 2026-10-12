import { create } from 'zustand'
import type { InboxFilterId } from '@renderer/features/paper/inbox-filters'
import { PANE_LIMITS, clampPaneWidth, type PaneId } from '@renderer/features/paper/pane-layout'
import { invoke } from '@renderer/lib/ipc'
import { toast } from './toast'

// Zentraler UI-Zustand des Letterpress-Frames (M19). Der Composer-Automat
// lebt hier, damit Owl-Rail und Listen-Chips („DRAFT READY") ihn sehen.

export type PaperView = 'inbox' | 'waiting' | 'tasks' | 'calendar' | 'settings' | 'chat' | 'compose'
export type SettingsSection = 'accounts' | 'appearance' | 'style' | 'sig' | 'intel' | 'tech'
/** Darstellung (Einstellung ui.layout): Letterpress-Original oder Outlook-nahes Classic. */
export type PaperLayout = 'letterpress' | 'classic'
export type Mbox = 'inbox' | 'sent' | 'spam'
export type PaperTheme = 'light' | 'dark'
export type CompMode = 'idle' | 'listening' | 'transcribing' | 'drafting' | 'ready' | 'sending'

export type CompResultKind = 'transcribed' | 'generated'
export type CompErrorKind = 'transcription' | 'generation' | 'send'

export interface CompState {
  mode: CompMode
  threadKey: string | null
  transcript: string
  secs: number
  processingSeconds: number
  text: string
  html: string
  originalText: string
  originalHtml: string
  resultKind: CompResultKind | null
  error: string | null
  errorKind: CompErrorKind | null
  generationStarted: boolean
  editing: boolean
  usedAlt: boolean
  manual: boolean
  elaborated: boolean
  draftId: string | null
  /** Allen antworten (M80): CC an die übrigen ursprünglichen Empfänger. */
  replyAll: boolean
  /** Kompatibilitaetsfeld fuer aeltere Reply-Entwuerfe. */
  reviseBase: string | null
}

const COMP_IDLE: CompState = {
  mode: 'idle',
  threadKey: null,
  transcript: '',
  secs: 0,
  processingSeconds: 0,
  text: '',
  html: '',
  originalText: '',
  originalHtml: '',
  resultKind: null,
  error: null,
  errorKind: null,
  generationStarted: false,
  editing: false,
  reviseBase: null,
  usedAlt: false,
  manual: false,
  elaborated: false,
  draftId: null,
  replyAll: false
}

interface PaperState {
  view: PaperView
  setView: (view: PaperView) => void
  // Auswahl je Liste
  selThreadKey: string | null
  setSelThreadKey: (key: string | null) => void
  selWaitingId: number | null
  setSelWaitingId: (id: number | null) => void
  selTaskId: number | null
  setSelTaskId: (id: number | null) => void
  showCompletedTasks: boolean
  setShowCompletedTasks: (show: boolean) => void
  showOpenTasks: boolean
  setShowOpenTasks: (show: boolean) => void
  setSel: SettingsSection
  setSetSel: (s: SettingsSection) => void
  // Ordner (EINGANG/GESENDET/SPAM)
  mbox: Mbox
  setMbox: (m: Mbox) => void
  // Konto-Filter (1/2/3, Chips)
  filter: number | null
  setFilter: (accountId: number | null) => void
  /** Ordneransicht: gewählter Einzelordner (null = vereinheitlichte Sicht über mbox). */
  folderId: number | null
  /** Ordner wählen: Konto + Sicht in einem Schritt; folderId nur für eigene Ordner/Archiv. */
  openFolder: (target: { accountId: number | null; mbox: Mbox; folderId: number | null }) => void
  // Darstellung (persistiert in settings ui.layout / mail.showFolders)
  layout: PaperLayout
  setLayout: (layout: PaperLayout) => void
  showFolders: boolean
  setShowFolders: (show: boolean) => void
  theme: PaperTheme
  setTheme: (theme: PaperTheme) => void
  // Spalten: Breite (gezogen) und Ordnerleiste ein/aus (Classic)
  paneWidths: Record<PaneId, number>
  /** persist=false während des Ziehens, true beim Loslassen (settings ui.paneWidths). */
  setPaneWidth: (id: PaneId, width: number, persist?: boolean) => void
  showFolderPane: boolean
  toggleFolderPane: () => void
  /** Spalten, die trotz Platzmangel offen bleiben sollen (Sitzung, nicht persistiert). */
  pinnedPanes: ReadonlySet<PaneId>
  /** Klick auf eine Leiste: aufklappen bzw. bei Platzmangel anheften. */
  expandPane: (id: PaneId, autoCollapsed: boolean) => void
  collapsePane: (id: PaneId) => void
  // Listen-Filter (Design Turn 7): Sitzungszustand, nicht persistiert
  inboxFilters: Set<InboxFilterId>
  toggleInboxFilter: (id: InboxFilterId) => void
  clearInboxFilters: () => void
  // Composer-Automat
  comp: CompState
  setComp: (patch: Partial<CompState>) => void
  resetComp: () => void
  // Seitenleisten (persistiert in settings ui.showList/ui.showRail)
  showList: boolean
  showRail: boolean
  toggleList: () => void
  toggleRail: () => void
  // Overlays
  paletteOpen: boolean
  setPaletteOpen: (v: boolean) => void
  helpOpen: boolean
  setHelpOpen: (v: boolean) => void
  onboarding: boolean
  setOnboarding: (v: boolean) => void
  /** Shim auf die zentrale Toast-Queue (Design 1c) — Call-Sites unverändert. */
  toastNow: (msg: string, durationMs?: number) => void
  // Ablegen mit Undo-Fenster (z)
  hiddenThreads: Set<string>
  stageArchive: (threadKey: string, messageIds: number[]) => void
  undoArchive: () => boolean
  /** Thread ohne Timer verstecken/zeigen (Rückgängig-Fenster beim Senden). */
  setThreadHidden: (threadKey: string, hidden: boolean) => void
}

/** Undo-Fenster fürs Ablegen — eine Quelle für stageArchive UND den Action-Toast. */
export const ARCHIVE_UNDO_WINDOW_MS = 5000

let pendingArchive: {
  threadKey: string
  messageIds: number[]
  timer: ReturnType<typeof setTimeout>
} | null = null

function commitArchive(): void {
  if (!pendingArchive) return
  const { messageIds } = pendingArchive
  clearTimeout(pendingArchive.timer)
  pendingArchive = null
  void invoke('messages:action', { messageIds, action: 'archive' })
}

export const usePaper = create<PaperState>((set) => ({
  view: 'inbox',
  setView: (view) => set({ view }),
  selThreadKey: null,
  setSelThreadKey: (selThreadKey) => set({ selThreadKey }),
  selWaitingId: null,
  setSelWaitingId: (selWaitingId) => set({ selWaitingId }),
  selTaskId: null,
  setSelTaskId: (selTaskId) => set({ selTaskId }),
  showCompletedTasks: false,
  setShowCompletedTasks: (showCompletedTasks) => set({ showCompletedTasks }),
  showOpenTasks: true,
  setShowOpenTasks: (showOpenTasks) => set({ showOpenTasks }),
  setSel: 'accounts',
  setSetSel: (setSel) => set({ setSel }),
  mbox: 'inbox',
  setMbox: (mbox) => set({ mbox, folderId: null, selThreadKey: null }),
  filter: null,
  setFilter: (filter) => set({ filter, folderId: null, selThreadKey: null }),
  folderId: null,
  openFolder: ({ accountId, mbox, folderId }) =>
    set({ filter: accountId, mbox, folderId, selThreadKey: null, view: 'inbox' }),
  layout: 'letterpress',
  setLayout: (layout) => {
    void invoke('settings:set', { key: 'ui.layout', value: layout })
    set({ layout })
  },
  theme: 'light',
  setTheme: (theme) => {
    void invoke('settings:set', { key: 'ui.theme', value: theme })
    set({ theme })
  },
  paneWidths: {
    folders: PANE_LIMITS.folders.default,
    list: PANE_LIMITS.list.default,
    rail: PANE_LIMITS.rail.default
  },
  setPaneWidth: (id, width, persist = false) =>
    set((s) => {
      const paneWidths = { ...s.paneWidths, [id]: clampPaneWidth(id, width) }
      if (persist) {
        void invoke('settings:set', { key: 'ui.paneWidths', value: JSON.stringify(paneWidths) })
      }
      return { paneWidths }
    }),
  showFolderPane: true,
  toggleFolderPane: () =>
    set((s) => {
      const next = !s.showFolderPane
      void invoke('settings:set', { key: 'ui.showFolderPane', value: next ? '1' : '0' })
      return { showFolderPane: next }
    }),
  pinnedPanes: new Set<PaneId>(),
  expandPane: (id, autoCollapsed) => {
    const s = usePaper.getState()
    if (autoCollapsed) {
      set({ pinnedPanes: new Set([...s.pinnedPanes, id]) })
      return
    }
    if (id === 'folders' && !s.showFolderPane) s.toggleFolderPane()
    if (id === 'list' && !s.showList) s.toggleList()
    if (id === 'rail' && !s.showRail) s.toggleRail()
  },
  collapsePane: (id) => {
    const s = usePaper.getState()
    const pinned = new Set(s.pinnedPanes)
    pinned.delete(id)
    set({ pinnedPanes: pinned })
    if (id === 'folders' && s.showFolderPane) s.toggleFolderPane()
    if (id === 'list' && s.showList) s.toggleList()
    if (id === 'rail' && s.showRail) s.toggleRail()
  },
  showFolders: false,
  setShowFolders: (showFolders) => {
    // Main liest mail.showFolders beim Ordner-Listing; der Refresh holt die Ordner sofort
    void invoke('settings:set', { key: 'mail.showFolders', value: showFolders ? '1' : '0' }).then(
      () => invoke('sync:trigger', undefined).catch(() => {})
    )
    set((s) => ({
      showFolders,
      ...(showFolders || s.folderId === null ? {} : { folderId: null, selThreadKey: null })
    }))
  },
  inboxFilters: new Set<InboxFilterId>(),
  toggleInboxFilter: (id) =>
    set((s) => {
      const next = new Set(s.inboxFilters)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { inboxFilters: next }
    }),
  clearInboxFilters: () =>
    set((s) => (s.inboxFilters.size === 0 ? {} : { inboxFilters: new Set() })),
  comp: COMP_IDLE,
  setComp: (patch) => set((s) => ({ comp: { ...s.comp, ...patch } })),
  resetComp: () => set({ comp: COMP_IDLE }),
  showList: true,
  showRail: true,
  toggleList: () =>
    set((s) => {
      const next = !s.showList
      void invoke('settings:set', { key: 'ui.showList', value: next ? '1' : '0' })
      return { showList: next }
    }),
  toggleRail: () =>
    set((s) => {
      const next = !s.showRail
      void invoke('settings:set', { key: 'ui.showRail', value: next ? '1' : '0' })
      return { showRail: next }
    }),
  paletteOpen: false,
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  helpOpen: false,
  setHelpOpen: (helpOpen) => set({ helpOpen }),
  onboarding: false,
  setOnboarding: (onboarding) => set({ onboarding }),
  toastNow: (msg, durationMs) => {
    toast.info(msg, durationMs !== undefined ? { durationMs } : {})
  },
  hiddenThreads: new Set<string>(),
  stageArchive: (threadKey, messageIds) => {
    // Nur ein Undo-Level: vorherigen Kandidaten endgültig ablegen
    commitArchive()
    const timer = setTimeout(() => {
      commitArchive()
    }, ARCHIVE_UNDO_WINDOW_MS)
    pendingArchive = { threadKey, messageIds, timer }
    set((s) => ({ hiddenThreads: new Set([...s.hiddenThreads, threadKey]) }))
  },
  undoArchive: () => {
    if (!pendingArchive) return false
    clearTimeout(pendingArchive.timer)
    const key = pendingArchive.threadKey
    pendingArchive = null
    set((s) => {
      const next = new Set(s.hiddenThreads)
      next.delete(key)
      return { hiddenThreads: next, selThreadKey: key }
    })
    return true
  },
  setThreadHidden: (threadKey, hidden) =>
    set((s) => {
      if (s.hiddenThreads.has(threadKey) === hidden) return {}
      const next = new Set(s.hiddenThreads)
      if (hidden) next.add(threadKey)
      else next.delete(threadKey)
      return { hiddenThreads: next }
    })
}))

/** Beim Start gemerkte Leisten-Zustände laden. */
export function initPanelPrefs(): void {
  void invoke('settings:get', { key: 'ui.showList' }).then((r) => {
    if (r.value === '0') usePaper.setState({ showList: false })
  })
  void invoke('settings:get', { key: 'ui.showRail' }).then((r) => {
    if (r.value === '0') usePaper.setState({ showRail: false })
  })
  void invoke('settings:get', { key: 'ui.layout' }).then((r) => {
    if (r.value === 'classic') usePaper.setState({ layout: 'classic' })
  })
  void invoke('settings:get', { key: 'mail.showFolders' }).then((r) => {
    if (r.value === '1') usePaper.setState({ showFolders: true })
  })
  void invoke('settings:get', { key: 'ui.theme' }).then((r) => {
    if (r.value === 'dark') usePaper.setState({ theme: 'dark' })
  })
  void invoke('settings:get', { key: 'ui.showFolderPane' }).then((r) => {
    if (r.value === '0') usePaper.setState({ showFolderPane: false })
  })
  void invoke('settings:get', { key: 'ui.paneWidths' }).then((r) => {
    if (!r.value) return
    try {
      const saved = JSON.parse(r.value) as Partial<Record<PaneId, unknown>>
      const widths = { ...usePaper.getState().paneWidths }
      for (const id of ['folders', 'list', 'rail'] as const) {
        if (typeof saved[id] === 'number') widths[id] = clampPaneWidth(id, saved[id])
      }
      usePaper.setState({ paneWidths: widths })
    } catch {
      // kaputter Wert: Standardbreiten behalten
    }
  })
}
