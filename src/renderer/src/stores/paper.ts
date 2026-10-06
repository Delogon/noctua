import { create } from 'zustand'
import type { InboxFilterId } from '@renderer/features/paper/inbox-filters'
import { invoke } from '@renderer/lib/ipc'
import { toast } from './toast'

// Zentraler UI-Zustand des Letterpress-Frames (M19). Der Composer-Automat
// lebt hier, damit Owl-Rail und Listen-Chips („DRAFT READY") ihn sehen.

export type PaperView = 'inbox' | 'waiting' | 'tasks' | 'calendar' | 'settings' | 'chat' | 'compose'
export type SettingsSection = 'accounts' | 'style' | 'sig' | 'intel' | 'tech'
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
  mbox: 'inbox' | 'sent' | 'spam'
  setMbox: (m: 'inbox' | 'sent' | 'spam') => void
  // Konto-Filter (1/2/3, Chips)
  filter: number | null
  setFilter: (accountId: number | null) => void
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
  setMbox: (mbox) => set({ mbox, selThreadKey: null }),
  filter: null,
  setFilter: (filter) => set({ filter, selThreadKey: null }),
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
}
