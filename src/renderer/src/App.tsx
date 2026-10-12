import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import { initPanelPrefs, usePaper } from '@renderer/stores/paper'
import { initDraftAutosave } from '@renderer/features/paper/draft-autosave'
import { onboardingBootDecision } from '@renderer/features/paper/onboarding-steps'
import { useUiStore } from '@renderer/stores/ui'
import { useAccounts } from '@renderer/queries/accounts'
import { useThreadInvalidation } from '@renderer/queries/threads'
import { useOutboxEchoLifecycle } from '@renderer/stores/send'
import { useTaskInvalidation } from '@renderer/queries/tasks'
import { useFollowupInvalidation } from '@renderer/queries/followups'
import { useCalendarLive } from '@renderer/queries/calendar'
import { installPaperKeymap } from '@renderer/keyboard/keymap'
import { initLanguage, t, useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { Masthead } from '@renderer/components/paper/Masthead'
import {
  ClassicAppRail,
  ClassicCommandBar,
  ClassicFolderPane,
  ClassicTopBar
} from '@renderer/components/paper/ClassicChrome'
import { ListPane } from '@renderer/features/paper/ListPane'
import { PaneStrip, ResizablePane } from '@renderer/features/paper/PaneFrame'
import { layoutPanes, type PaneId, type PaneInput } from '@renderer/features/paper/pane-layout'
import { EmailSheet } from '@renderer/features/paper/EmailSheet'
import { WaitingSheet } from '@renderer/features/paper/WaitingSheet'
import { TaskSheet } from '@renderer/features/paper/TaskSheet'
import {
  AccountsSheet,
  AppearanceSheet,
  IntelSheet,
  StyleSheetView
} from '@renderer/features/paper/SettingsSheets'
import { SigSheet } from '@renderer/features/paper/SigSheet'
import { TechSheet } from '@renderer/features/settings/TechSheet'
import { ComposeSheet } from '@renderer/features/paper/ComposeSheet'
import { OwlRail } from '@renderer/features/paper/OwlRail'
import { CalendarSheet } from '@renderer/features/calendar/CalendarSheet'
import { Onboarding } from '@renderer/features/paper/Onboarding'
import { HelpOverlay, PaperPalette } from '@renderer/components/paper/Overlays'
import { ToastHost } from '@renderer/components/paper/Toast'
import { OwlView } from '@renderer/features/owl/OwlView'
import { useOwl } from '@renderer/stores/owl'
import { AddAccountDialog } from '@renderer/features/onboarding/AddAccountDialog'

/** Fensterbreite für die automatische Spaltenaufteilung (pane-layout.ts). */
function useWindowWidth(): number {
  const [width, setWidth] = useState(() => window.innerWidth)
  useEffect(() => {
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/** Breite der Classic-App-Leiste links (CSS .classic-rail). */
const CLASSIC_RAIL_WIDTH = 52

function PanelGate(): React.JSX.Element {
  const t = useT()
  const showList = usePaper((s) => s.showList)
  const showRail = usePaper((s) => s.showRail)
  const showFolderPane = usePaper((s) => s.showFolderPane)
  const paneWidths = usePaper((s) => s.paneWidths)
  const pinned = usePaper((s) => s.pinnedPanes)
  const classic = usePaper((s) => s.layout === 'classic')
  const view = usePaper((s) => s.view)
  const windowWidth = useWindowWidth()
  const withFolders = classic && (view === 'inbox' || view === 'compose')

  const panes: PaneInput[] = [
    ...(withFolders
      ? [{ id: 'folders' as const, open: showFolderPane, width: paneWidths.folders }]
      : []),
    { id: 'list', open: showList, width: paneWidths.list },
    { id: 'rail', open: showRail, width: paneWidths.rail }
  ]
  const layout = layoutPanes(panes, windowWidth - (classic ? CLASSIC_RAIL_WIDTH : 0), pinned)

  const pane = (
    id: PaneId,
    side: 'left' | 'right',
    label: string,
    content: React.ReactNode
  ): React.ReactNode =>
    layout[id].visible ? (
      <ResizablePane id={id} side={side} width={layout[id].width} label={label}>
        {content}
      </ResizablePane>
    ) : (
      <PaneStrip id={id} side={side} label={label} autoCollapsed={layout[id].autoCollapsed} />
    )

  return (
    <>
      {withFolders && pane('folders', 'left', t('foldersTreeAria'), <ClassicFolderPane />)}
      {pane('list', 'left', t('paneList'), <ListPane />)}
      <CenterSheet />
      {pane('rail', 'right', t('classicOwl'), <OwlRail />)}
    </>
  )
}

function CenterSheet(): React.JSX.Element {
  const { view, setSel } = usePaper()
  const classic = usePaper((s) => s.layout === 'classic')
  return (
    <div className="flex min-w-0 flex-1 overflow-hidden" style={{ padding: '18px 20px' }}>
      {view === 'inbox' &&
        (classic ? (
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <ClassicCommandBar />
            <div className="flex min-h-0 flex-1">
              <EmailSheet />
            </div>
          </div>
        ) : (
          <EmailSheet />
        ))}
      {view === 'compose' && <ComposeSheet />}
      {view === 'waiting' && <WaitingSheet />}
      {view === 'tasks' && <TaskSheet />}
      {view === 'calendar' && <CalendarSheet />}
      {view === 'settings' && setSel === 'accounts' && <AccountsSheet />}
      {view === 'settings' && setSel === 'appearance' && <AppearanceSheet />}
      {view === 'settings' && setSel === 'style' && <StyleSheetView />}
      {view === 'settings' && setSel === 'sig' && <SigSheet />}
      {view === 'settings' && setSel === 'intel' && <IntelSheet />}
      {view === 'settings' && setSel === 'tech' && <TechSheet />}
      {view === 'chat' && <OwlView />}
    </div>
  )
}

function App(): React.JSX.Element {
  const accounts = useAccounts()
  const accountIdsRef = useRef<readonly number[]>([])
  const onboarding = usePaper((s) => s.onboarding)
  const layout = usePaper((s) => s.layout)
  const theme = usePaper((s) => s.theme)
  const queryClient = useQueryClient()
  useThreadInvalidation()
  useTaskInvalidation()
  useFollowupInvalidation()
  useCalendarLive()
  useOutboxEchoLifecycle()

  useEffect(
    () =>
      initDraftAutosave(() => {
        void queryClient.invalidateQueries({ queryKey: ['drafts'] })
      }),
    [queryClient]
  )

  useEffect(() => {
    initLanguage()
    initPanelPrefs()
    // Onboarding beim Erststart zeigen, nach Unterbrechung fortsetzen —
    // nur echte Bestandskonten (Flow lief nie) zählen als onboarded.
    void invoke('settings:get', { key: 'noctua.onboarded' }).then(async (r) => {
      if (r.value === '1') return
      const [started, accs] = await Promise.all([
        invoke('settings:get', { key: 'noctua.onboardingStarted' }),
        invoke('accounts:list', undefined)
      ])
      const decision = onboardingBootDecision({
        onboarded: false,
        started: started.value === '1',
        accountCount: accs.accounts.length
      })
      if (decision === 'legacyMarkOnboarded') {
        void invoke('settings:set', { key: 'noctua.onboarded', value: '1' })
      } else if (decision === 'show' || decision === 'resume') {
        usePaper.getState().setOnboarding(true)
      }
    })
  }, [])

  // macOS-Ampel mittig zur Kopfzeile des aktiven Layouts setzen
  const chromeLayout = onboarding ? 'letterpress' : layout
  useEffect(() => {
    void invoke('app:setWindowChrome', { layout: chromeLayout }).catch(() => {})
  }, [chromeLayout])

  useEffect(() => {
    accountIdsRef.current = (accounts.data ?? []).map((account) => account.id)
  }, [accounts.data])

  useEffect(() => installPaperKeymap(() => accountIdsRef.current), [])

  // Update-Hinweis: statt Banner eine persistente Info-Toast mit
  // Download-Aktion (Design 1c) — der echte Kanal bleibt updates:available
  // plus app:openExternal auf die Release-Seite.
  const updateToastRef = useRef<number | null>(null)
  useEffect(
    () =>
      onPush('updates:available', ({ latest, url }) => {
        // Wiederholte Checks (alle 6h) ersetzen die vorhandene Toast, statt zu stapeln
        if (updateToastRef.current !== null) toast.dismiss(updateToastRef.current)
        updateToastRef.current = toast.info(t('updateAvailable', { v: latest }), {
          dismiss: true,
          action: {
            label: t('updateDownload'),
            run: () => void invoke('app:openExternal', { url })
          }
        })
      }),
    []
  )

  // Dead-Letter der IMAP-Op-Queue: nie still verwerfen, sondern sichtbar melden
  useEffect(
    () =>
      onPush('sync:opsDead', ({ count, reason }) => {
        const key =
          reason === 'attempts'
            ? 'opsDeadAttempts'
            : reason === 'uidvalidity'
              ? 'opsDeadUidvalidity'
              : reason === 'folder-gone'
                ? 'opsDeadFolderGone'
                : 'opsDeadNoTarget'
        toast.error(t(key, { n: count }))
      }),
    []
  )

  // Kalender: abgelehnte lokale Änderungen (Konflikt, Server-Version gewinnt) nie still verwerfen
  useEffect(
    () =>
      onPush('calendar:conflict', ({ summary, reason }) => {
        const key =
          reason === 'conflict'
            ? 'calConflictConflict'
            : reason === 'deleted-on-server'
              ? 'calConflictGone'
              : reason === 'forbidden'
                ? 'calConflictForbidden'
                : 'calConflictAttempts'
        toast.error(t(key, { title: summary ?? '' }))
      }),
    []
  )

  // Native Menü-Aktionen + Notification-Klick
  useEffect(() => {
    const offMenu = onPush('app:menuAction', ({ action }) => {
      const paper = usePaper.getState()
      const ui = useUiStore.getState()
      if (action === 'inbox') paper.setView('inbox')
      else if (action === 'waiting') paper.setView('waiting')
      else if (action === 'tasks') paper.setView('tasks')
      else if (action === 'calendar') paper.setView('calendar')
      else if (action === 'chat') paper.setView('chat')
      else if (action === 'settings') paper.setView('settings')
      else if (action === 'shortcuts') paper.setHelpOpen(!paper.helpOpen)
      else if (action === 'search') {
        // ⌘F: Suchen wohnt in der Owl-View — Feld gleich fokussieren
        paper.setView('chat')
        useOwl.getState().requestFocus()
      } else if (action === 'addAccount') ui.setAddAccountOpen(true)
      else if (action === 'compose') paper.setView('compose')
    })
    const offThread = onPush('app:openThread', ({ threadKey }) => {
      usePaper.getState().setView('inbox')
      usePaper.getState().setSelThreadKey(threadKey)
    })
    return () => {
      offMenu()
      offThread()
    }
  }, [])

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden"
      data-layout={onboarding ? 'letterpress' : layout}
      data-theme={theme}
      // Classic hat keine breite Kopfzeile: schmalere Fenster gehen, die Spalten weichen aus
      style={{
        minWidth: layout === 'classic' && !onboarding ? 860 : 1180,
        background: 'var(--paper)',
        color: 'var(--ink)'
      }}
    >
      {onboarding ? (
        <Onboarding />
      ) : layout === 'classic' ? (
        <>
          <ClassicTopBar />
          <div className="flex min-h-0 flex-1">
            <ClassicAppRail />
            <PanelGate />
          </div>
        </>
      ) : (
        <>
          <Masthead />
          <div className="flex min-h-0 flex-1">
            <PanelGate />
          </div>
        </>
      )}

      <PaperPalette />
      <HelpOverlay />
      <ToastHost />
      <AddAccountDialog />
    </div>
  )
}

export default App
