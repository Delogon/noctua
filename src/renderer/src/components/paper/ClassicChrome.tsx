import { usePaper, type PaperView } from '@renderer/stores/paper'
import { useOwl } from '@renderer/stores/owl'
import { useT } from '@renderer/lib/i18n'
import type { StringKey } from '@renderer/i18n/strings'
import { useFollowups } from '@renderer/queries/followups'
import { useTasks } from '@renderer/queries/tasks'
import { useLocalOnly } from '@renderer/queries/intel'
import { FolderTree } from '@renderer/features/paper/FolderTree'

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
  settings:
    'M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4'
}

function Icon({ name }: { name: keyof typeof ICONS }): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="classic-icon">
      <path d={ICONS[name]} />
    </svg>
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
