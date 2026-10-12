import { usePaper } from '@renderer/stores/paper'
import { useOwl } from '@renderer/stores/owl'
import { useI18n, useT, mastheadDate } from '@renderer/lib/i18n'
import { useMboxCounts } from '@renderer/queries/threads'
import { useFollowups } from '@renderer/queries/followups'
import { useTasks } from '@renderer/queries/tasks'
import { useLocalOnly } from '@renderer/queries/intel'

function NavItem({
  label,
  count,
  kbd,
  active,
  onClick
}: {
  label: string
  count?: number
  kbd: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className="masthead-nav-item"
      data-active={active}
      aria-current={active ? 'page' : undefined}
    >
      {label}
      {count !== undefined ? ` ${count}` : ''}
      <kbd>{kbd}</kbd>
    </button>
  )
}

function PanelIcon({
  side,
  active,
  onClick,
  label
}: {
  side: 'left' | 'right'
  active: boolean
  onClick: () => void
  label: string
}): React.JSX.Element {
  const fillX = side === 'left' ? 2.5 : 10.5
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className="masthead-panel-toggle"
      data-active={active}
    >
      <svg width="17" height="14" viewBox="0 0 17 14" aria-hidden="true">
        <rect
          x="1"
          y="1"
          width="15"
          height="12"
          fill="none"
          stroke="var(--ink)"
          strokeWidth="1.4"
        />
        <rect x={fillX} y="2.5" width="4" height="9" fill="var(--ink)" />
      </svg>
    </button>
  )
}

export function Masthead(): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const { view, setView, setSetSel, showList, showRail, toggleList, toggleRail } = usePaper()
  const localOnly = useLocalOnly().data === true
  const counts = useMboxCounts(null)
  const followups = useFollowups()
  const tasks = useTasks('open')

  return (
    <div
      className="titlebar-drag flex flex-none items-center gap-4 border-b border-ink"
      style={{ padding: '16px 26px 12px 96px' }}
    >
      <div style={{ font: '500 24px var(--serif)', fontStyle: 'italic', letterSpacing: '.5px' }}>
        Noctua
      </div>
      <div className="mmeta" style={{ letterSpacing: '1px' }}>
        {mastheadDate(lang)}
      </div>
      {/* „Nur lokal" ist an: klar sichtbar, Klick führt zum Schalter */}
      {localOnly && (
        <button
          type="button"
          className="titlebar-no-drag localonly-badge"
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
      <div
        className="titlebar-no-drag ml-auto flex items-center gap-3.5"
        style={{ font: '400 10px var(--mono)' }}
      >
        <NavItem
          label={t('mastheadSearch')}
          kbd="/"
          active={view === 'chat'}
          onClick={() => {
            // SUCHEN ist der einzige Einstieg in die Owl-View (Tims Entscheid:
            // kein separates EULE-Item, kein ⌘5) — Feld direkt fokussieren
            setView('chat')
            useOwl.getState().requestFocus()
          }}
        />
        {/* Ruhiger Zeiger-Eintrag für den Composer (Design 3f) — dieselbe
            Aktion wie ⌘N im Ablage-Menü, kein eigener Button-Kasten */}
        <NavItem
          label={t('navCompose')}
          kbd="⌘N"
          active={view === 'compose'}
          onClick={() => setView('compose')}
        />
        <NavItem
          label={t('navInbox')}
          count={counts.data?.inbox ?? 0}
          kbd="⌘1"
          active={view === 'inbox'}
          onClick={() => setView('inbox')}
        />
        <NavItem
          label={t('navWaiting')}
          count={followups.data?.length ?? 0}
          kbd="⌘2"
          active={view === 'waiting'}
          onClick={() => setView('waiting')}
        />
        <NavItem
          label={t('navTasks')}
          count={tasks.data?.tasks.length ?? 0}
          kbd="⌘3"
          active={view === 'tasks'}
          onClick={() => setView('tasks')}
        />
        <NavItem
          label={t('navCalendar')}
          kbd="⌘4"
          active={view === 'calendar'}
          onClick={() => setView('calendar')}
        />
        <NavItem
          label={t('navSettings')}
          kbd="⌘,"
          active={view === 'settings'}
          onClick={() => setView('settings')}
        />
        <span className="flex items-center gap-2" style={{ marginLeft: 2 }}>
          <PanelIcon
            side="left"
            active={showList}
            onClick={toggleList}
            label={t('toggleListLabel')}
          />
          <PanelIcon
            side="right"
            active={showRail}
            onClick={toggleRail}
            label={t('toggleRailLabel')}
          />
        </span>
      </div>
    </div>
  )
}
