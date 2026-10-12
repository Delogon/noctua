import { usePaper, type PaperView } from '@renderer/stores/paper'
import { useOwl } from '@renderer/stores/owl'
import { useT } from '@renderer/lib/i18n'
import type { StringKey } from '@renderer/i18n/strings'
import { useFollowups } from '@renderer/queries/followups'
import { useTasks } from '@renderer/queries/tasks'
import { useLocalOnly } from '@renderer/queries/intel'
import { useThreads } from '@renderer/queries/threads'
import { FolderTree } from '@renderer/features/paper/FolderTree'
import type { PaneId } from '@renderer/features/paper/pane-layout'
import { ThemeToggle } from './ThemeToggle'

/**
 * „Classic"-Rahmen (Einstellung ui.layout): Outlook-nahe Muster — Titelleiste
 * mit Suchfeld, App-Leiste links, Ordnerleiste mit „Neue E-Mail". Inhalt,
 * Liste, Blatt und Eulen-Leiste sind dieselben Komponenten wie im Letterpress.
 */

const ICONS: Record<'mail' | 'waiting' | 'tasks' | 'calendar' | 'owl' | 'settings', string> = {
  mail: 'M2 4h12v8H2z M2 4l6 5 6-5',
  waiting: 'M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z M8 5v3.2l2 1.3',
  tasks: 'M2.5 2.5h11v11h-11z M5 8l2 2 4-4',
  calendar: 'M2.5 3.5h11v10h-11z M2.5 6.5h11 M5.5 2v3 M10.5 2v3',
  owl: 'M3 5.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z M8 5.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z M3 5.5v5.5l5 3 5-3V5.5',
  // Zahnrad (nicht Sonne — die Sonne ist der Hell/Dunkel-Schalter)
  settings:
    'M6.9 1.5h2.2l.4 1.7 1.2.5 1.5-.9 1.6 1.6-.9 1.5.5 1.2 1.7.4v2.2l-1.7.4-.5 1.2.9 1.5-1.6 1.6-1.5-.9-1.2.5-.4 1.7H6.9l-.4-1.7-1.2-.5-1.5.9-1.6-1.6.9-1.5-.5-1.2-1.7-.4V6.9l1.7-.4.5-1.2-.9-1.5 1.6-1.6 1.5.9 1.2-.5z M8 5.9a2.1 2.1 0 1 0 0 4.2a2.1 2.1 0 1 0 0-4.2z'
}

function Icon({ name }: { name: keyof typeof ICONS }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="classic-icon">
      <path d={ICONS[name]} />
    </svg>
  )
}

/** Spalten ein-/ausblenden (Ordner, Liste, Eule) — wie Outlooks Ansicht-Menü, nur direkt. */
function PaneToggles(): React.JSX.Element {
  const t = useT()
  const view = usePaper((s) => s.view)
  const folders = usePaper((s) => s.showFolderPane)
  const list = usePaper((s) => s.showList)
  const rail = usePaper((s) => s.showRail)
  const open: Record<PaneId, boolean> = { folders, list, rail }
  const expandPane = usePaper((s) => s.expandPane)
  const collapsePane = usePaper((s) => s.collapsePane)
  const items: Array<{ id: PaneId; label: string; fill: string }> = [
    ...(view === 'inbox' || view === 'compose'
      ? [{ id: 'folders' as const, label: t('foldersTreeAria'), fill: 'M2.5 2.5h3v11h-3z' }]
      : []),
    { id: 'list', label: t('paneList'), fill: 'M5.5 2.5h4v11h-4z' },
    { id: 'rail', label: t('classicOwl'), fill: 'M10.5 2.5h3v11h-3z' }
  ]
  return (
    <div className="classic-pane-toggles" role="group" aria-label={t('panesHead')}>
      {items.map((item) => {
        const label = open[item.id]
          ? t('paneCollapseAria', { name: item.label })
          : t('paneExpandAria', { name: item.label })
        return (
          <button
            key={item.id}
            type="button"
            className="classic-topbar__btn"
            aria-pressed={open[item.id]}
            aria-label={label}
            title={label}
            onClick={() => (open[item.id] ? collapsePane(item.id) : expandPane(item.id, false))}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" className="classic-icon">
              <path d="M1.5 2.5h13v11h-13z" />
              <path d={item.fill} className="classic-pane-toggles__fill" />
            </svg>
          </button>
        )
      })}
    </div>
  )
}

export function ClassicTopBar(): React.JSX.Element {
  const t = useT()
  const setView = usePaper((s) => s.setView)
  const setSetSel = usePaper((s) => s.setSetSel)
  const localOnly = useLocalOnly().data === true
  return (
    <div className="classic-topbar titlebar-drag">
      <div className="classic-topbar__brand">Noctua</div>
      {/* Suchen wohnt in der Eulen-Ansicht — das Feld ist ihr Einstieg (wie ⌘F) */}
      <button
        type="button"
        className="classic-search titlebar-no-drag"
        onClick={() => {
          setView('chat')
          useOwl.getState().requestFocus()
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true" className="classic-icon">
          <path d="M7 2a5 5 0 1 0 0 10a5 5 0 1 0 0-10z M11 11l3.5 3.5" />
        </svg>
        <span>{t('classicSearch')}</span>
        <kbd>/</kbd>
      </button>
      <div className="classic-topbar__end titlebar-no-drag">
        <PaneToggles />
        <ThemeToggle className="classic-topbar__btn" />
        {localOnly && (
          <button
            type="button"
            className="localonly-badge"
            title={t('localOnlyBadgeTip')}
            onClick={() => {
              setSetSel('intel')
              setView('settings')
            }}
          >
            <span aria-hidden="true" className="localonly-badge__dot" />
            {t('localOnlyBadge')}
          </button>
        )}
      </div>
    </div>
  )
}

export function ClassicAppRail(): React.JSX.Element {
  const t = useT()
  const view = usePaper((s) => s.view)
  const setView = usePaper((s) => s.setView)
  const followups = useFollowups()
  const tasks = useTasks('open')
  const items: Array<{
    id: PaperView
    icon: keyof typeof ICONS
    label: StringKey
    kbd?: string
    count?: number
  }> = [
    { id: 'inbox', icon: 'mail', label: 'classicMail', kbd: '⌘1' },
    {
      id: 'waiting',
      icon: 'waiting',
      label: 'classicWaiting',
      kbd: '⌘2',
      count: followups.data?.length
    },
    {
      id: 'tasks',
      icon: 'tasks',
      label: 'classicTasks',
      kbd: '⌘3',
      count: tasks.data?.tasks.length
    },
    { id: 'calendar', icon: 'calendar', label: 'classicCalendar', kbd: '⌘4' },
    { id: 'chat', icon: 'owl', label: 'classicOwl' }
  ]
  const isActive = (id: PaperView): boolean =>
    id === 'inbox' ? view === 'inbox' || view === 'compose' : view === id
  return (
    <nav className="classic-rail" aria-label={t('classicAppsAria')}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="classic-rail__item"
          data-active={isActive(item.id)}
          aria-current={isActive(item.id) ? 'page' : undefined}
          aria-label={t(item.label)}
          title={item.kbd ? `${t(item.label)} (${item.kbd})` : t(item.label)}
          onClick={() => setView(item.id)}
        >
          <Icon name={item.icon} />
          {item.count !== undefined && item.count > 0 && (
            <span className="classic-rail__badge">{item.count}</span>
          )}
        </button>
      ))}
      <button
        type="button"
        className="classic-rail__item"
        style={{ marginTop: 'auto' }}
        data-active={view === 'settings'}
        aria-current={view === 'settings' ? 'page' : undefined}
        aria-label={t('classicSettings')}
        title={`${t('classicSettings')} (⌘,)`}
        onClick={() => setView('settings')}
      >
        <Icon name="settings" />
      </button>
    </nav>
  )
}

export function ClassicFolderPane(): React.JSX.Element {
  const t = useT()
  const setView = usePaper((s) => s.setView)
  const showFolders = usePaper((s) => s.showFolders)
  return (
    <div className="classic-folders">
      <div style={{ padding: 12 }}>
        <button type="button" className="classic-newmail" onClick={() => setView('compose')}>
          <svg viewBox="0 0 16 16" aria-hidden="true" className="classic-icon">
            <path d="M8 3v10 M3 8h10" />
          </svg>
          {t('classicNewMail')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '0 8px 8px' }}>
        <FolderTree showUserFolders={showFolders} />
      </div>
    </div>
  )
}

const CMD_ICONS = {
  reply: 'M6.5 4 2.5 8l4 4 M2.5 8h7a4 4 0 0 1 4 4v1',
  replyAll: 'M8.5 4 4.5 8l4 4 M5 4 1 8l4 4 M4.5 8h6a4 4 0 0 1 4 4v1',
  dictate: 'M8 2a2 2 0 0 1 2 2v4a2 2 0 0 1-4 0V4a2 2 0 0 1 2-2z M4 7.5a4 4 0 0 0 8 0 M8 11.5V14',
  archive: 'M2 3h12v3H2z M3 6v7h10V6 M6.5 8.5h3',
  delete: 'M3 4.5h10 M6.5 4.5V3h3v1.5 M4.5 4.5l.7 9h5.6l.7-9',
  junk: 'M8 2 14 13H2z M8 6.5v3 M8 11.2v.1',
  notJunk: 'M2.5 8.5 6 12l7.5-8'
} as const

type CmdAction = 'reply' | 'replyAll' | 'dictate' | 'file' | 'delete' | 'spam' | 'notSpam'

/**
 * Befehlsleiste über der geöffneten E-Mail (nur Classic) — Outlooks
 * Menüband in klein. Löst dieselben paper:mail-Aktionen aus wie die Tasten,
 * damit EmailSheet die einzige Stelle bleibt, die Threads verändert.
 */
export function ClassicCommandBar(): React.JSX.Element {
  const t = useT()
  const { filter, mbox, folderId, hiddenThreads } = usePaper()
  const threads = useThreads(filter, mbox, folderId)
  const hasThread = (threads.data ?? []).some((r) => !hiddenThreads.has(r.threadKey))
  const run = (action: CmdAction): void => {
    window.dispatchEvent(new CustomEvent('paper:mail', { detail: action }))
  }
  const items: Array<{
    action: CmdAction
    icon: keyof typeof CMD_ICONS
    label: StringKey
    kbd?: string
  }> =
    mbox === 'inbox'
      ? [
          { action: 'reply', icon: 'reply', label: 'barReply', kbd: 'r' },
          { action: 'replyAll', icon: 'replyAll', label: 'barReplyAll', kbd: 'a' },
          { action: 'dictate', icon: 'dictate', label: 'barDictate', kbd: '⌘D' },
          { action: 'file', icon: 'archive', label: 'barArchive', kbd: 'e' },
          { action: 'delete', icon: 'delete', label: 'barDelete' },
          { action: 'spam', icon: 'junk', label: 'barJunk' }
        ]
      : mbox === 'spam'
        ? [
            { action: 'notSpam', icon: 'notJunk', label: 'barNotJunk' },
            { action: 'delete', icon: 'delete', label: 'barDelete' }
          ]
        : [{ action: 'delete', icon: 'delete', label: 'barDelete' }]
  return (
    <div className="classic-cmdbar" role="toolbar" aria-label={t('barAria')}>
      {items.map((item) => (
        <button
          key={item.action}
          type="button"
          className="classic-cmdbar__item"
          disabled={!hasThread}
          title={item.kbd ? `${t(item.label)} (${item.kbd})` : t(item.label)}
          onClick={() => run(item.action)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" className="classic-icon">
            <path d={CMD_ICONS[item.icon]} />
          </svg>
          {t(item.label)}
        </button>
      ))}
    </div>
  )
}
