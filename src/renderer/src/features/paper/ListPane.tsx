import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { TaskSyncGlyph } from './TaskSyncGlyph'
import { contrastOn, type AccountSummary, type ThreadListItem } from '@shared/types'
import { useMboxCounts, useThreads } from '@renderer/queries/threads'
import { useDrafts } from '@renderer/queries/drafts'
import { useFollowups } from '@renderer/queries/followups'
import { useTasks } from '@renderer/queries/tasks'
import { useAccounts } from '@renderer/queries/accounts'
import { usePaper, type SettingsSection } from '@renderer/stores/paper'
import { echoConfirmedBy, useSendState } from '@renderer/stores/send'
import { useI18n, useT, rowTime } from '@renderer/lib/i18n'
import { useOrKeyStatus, useModels } from '@renderer/queries/intel'
import { invoke } from '@renderer/lib/ipc'
import { accountLabels } from '@renderer/lib/accountLabels'
import { accountFilterForHotkey, accountHotkeyForIndex } from '@renderer/keyboard/account-hotkeys'
import { usePopoverPlacement } from '@renderer/lib/popover-placement'
import { nudgedToday } from '@renderer/features/paper/nudge-send'
import { priorityTickTone } from '@renderer/features/paper/priority'
import { applyFilters, filterCounts } from '@renderer/features/paper/inbox-filters'
import { InboxFilterMenu } from '@renderer/features/paper/InboxFilterMenu'
import { OwlConversationsPane } from '@renderer/features/owl/OwlConversationsPane'
import { useOwl } from '@renderer/stores/owl'
import { CalendarSidebar } from '@renderer/features/calendar/CalendarSidebar'
import {
  taskIdAfterCompletion,
  taskIdAfterVisibilityChange,
  visibleTaskRows
} from './task-navigation'

/** Badge in der Konto-Farbe (Pastell) mit kontrastierender Schrift. */
function badgeStyle(color: string): React.CSSProperties {
  return {
    width: 13,
    height: 13,
    flex: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    font: '600 7.5px var(--mono)',
    background: color,
    color: contrastOn(color),
    border: '1px solid color-mix(in oklab, ' + color + ' 60%, var(--ink))'
  }
}

/** 5a: Rang-Tick am Zeilenanfang — Rang 5 Akzent (klingelt), Rang 4 Ink. */
function PriorityTick({ aiPriority }: { aiPriority: number | null }): React.JSX.Element | null {
  const t = useT()
  const tone = priorityTickTone(aiPriority)
  if (!tone) return null
  const label = tone === 'accent' ? t('prioAria5') : t('prioAria4')
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{
        width: 3,
        height: 13,
        background: tone === 'accent' ? 'var(--ac)' : 'var(--ink)',
        flex: 'none',
        alignSelf: 'center'
      }}
    />
  )
}

function Header({ left, right }: { left: string; right?: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className="mlabel flex flex-none items-center border-b border-hairline"
      style={{ padding: '9px 18px 7px', color: 'var(--muted)' }}
    >
      <span className="flex-1">{left}</span>
      {right && <div className="flex-none">{right}</div>}
    </div>
  )
}

function Empty({ line, sub }: { line: string; sub: string }): React.JSX.Element {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center' }}>
      <div
        style={{ font: '400 16px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }}
      >
        {line}
      </div>
      <div className="mmeta" style={{ color: 'var(--faint)', marginTop: 8 }}>
        {sub}
      </div>
    </div>
  )
}

function useScrollToSelected(dep: unknown): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [dep])
  return ref
}

function TaskStatusFilter({
  openCount,
  completedCount,
  showOpen,
  showCompleted,
  onShowOpenChange,
  onShowCompletedChange
}: {
  openCount: number
  completedCount: number
  showOpen: boolean
  showCompleted: boolean
  onShowOpenChange: (show: boolean) => void
  onShowCompletedChange: (show: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = usePopoverPlacement(popoverOpen)
  const stateLabel =
    showOpen && showCompleted
      ? t('tasksFilterAll')
      : showOpen
        ? t('tasksFilterOpen')
        : showCompleted
          ? t('tasksFilterCompleted')
          : t('tasksFilterNone')

  useEffect(() => {
    if (!popoverOpen) return

    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setPopoverOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setPopoverOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [popoverOpen])

  return (
    <div ref={rootRef} className="list-filter-control">
      <span className="list-filter-label">{t('tasksFilterStatus')}</span>
      <span className="list-filter-value">{stateLabel}</span>
      <button
        ref={triggerRef}
        type="button"
        className="list-filter-trigger"
        data-active={!(showOpen && showCompleted)}
        data-open={popoverOpen}
        aria-label={t('tasksFilterAria', { state: stateLabel })}
        aria-haspopup="dialog"
        aria-expanded={popoverOpen}
        aria-controls="task-status-filter-popover"
        onClick={() => setPopoverOpen((open) => !open)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2 3h12L9.5 8.1v3.6l-3 1.3V8.1L2 3Z" />
        </svg>
      </button>

      {popoverOpen && (
        <div
          ref={popoverRef}
          popover="manual"
          id="task-status-filter-popover"
          className="list-filter-popover"
          role="dialog"
          aria-label={t('tasksFilterAria', { state: stateLabel })}
        >
          <fieldset>
            <legend>{t('tasksFilterStatus')}</legend>
            <label className="list-filter-option" htmlFor="task-filter-open">
              <input
                id="task-filter-open"
                type="checkbox"
                checked={showOpen}
                disabled={openCount === 0 && !showOpen}
                onChange={(event) => onShowOpenChange(event.target.checked)}
              />
              <span className="list-filter-check" aria-hidden="true" />
              <span>{t('tasksFilterOpen')}</span>
              <span className="list-filter-count">{openCount}</span>
            </label>
            <label className="list-filter-option" htmlFor="task-filter-completed">
              <input
                id="task-filter-completed"
                type="checkbox"
                checked={showCompleted}
                disabled={completedCount === 0 && !showCompleted}
                onChange={(event) => onShowCompletedChange(event.target.checked)}
              />
              <span className="list-filter-check" aria-hidden="true" />
              <span>{t('tasksFilterCompleted')}</span>
              <span className="list-filter-count">{completedCount}</span>
            </label>
          </fieldset>
          <div className="list-filter-hint">{t('tasksSub')}</div>
        </div>
      )}
    </div>
  )
}

function AccountFilterMark({
  accounts,
  account
}: {
  accounts: AccountSummary[]
  account?: AccountSummary
}): React.JSX.Element {
  if (account) {
    return (
      <span
        className="account-filter-swatch"
        style={{ background: account.color }}
        aria-hidden="true"
      />
    )
  }

  return (
    <span className="account-filter-stack" aria-hidden="true">
      {(accounts.length > 0 ? accounts.slice(0, 3) : [null]).map((item, index) => (
        <span
          key={item?.id ?? 'empty'}
          style={{ background: item?.color ?? 'var(--hairline)' }}
          data-position={index}
        />
      ))}
    </span>
  )
}

function AccountFilter({
  accounts,
  loading,
  filter,
  onChange
}: {
  accounts: AccountSummary[]
  loading: boolean
  filter: number | null
  onChange: (accountId: number | null) => void
}): React.JSX.Element {
  const t = useT()
  const menuId = useId()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = usePopoverPlacement(open)
  const activeAccount = accounts.find((account) => account.id === filter)
  const displayAccount = activeAccount ?? (accounts.length === 1 ? accounts[0] : undefined)
  const activeLabel = loading
    ? t('mailboxFilterLoading')
    : accounts.length === 0
      ? t('mailboxFilterNone')
      : (displayAccount?.accountName ?? t('mailboxFilterAll'))
  const selectable = !loading && accounts.length > 1

  useEffect(() => {
    if (loading || filter === null) return
    if (accounts.length <= 1 || !activeAccount) onChange(null)
  }, [accounts.length, activeAccount, filter, loading, onChange])

  useEffect(() => {
    if (!open) return

    const closeOutside = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]')
        ?.focus()
    })
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  const select = (accountId: number | null): void => {
    onChange(accountId)
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }

  const moveWithinMenu = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const accountFilter =
      !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.repeat
        ? accountFilterForHotkey(
            event.key,
            accounts.map((account) => account.id)
          )
        : undefined
    if (accountFilter !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      if (accountFilter === filter) {
        setOpen(false)
        requestAnimationFrame(() => triggerRef.current?.focus())
      } else {
        select(accountFilter)
      }
      return
    }

    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')
    )
    const current = options.indexOf(document.activeElement as HTMLElement)
    const direction = event.key === 'ArrowDown' ? 1 : -1
    options[(current + direction + options.length) % options.length]?.focus()
  }

  return (
    <div className="account-filter-row list-filter-row">
      <div ref={rootRef} className="account-filter-control list-filter-control">
        <span className="list-filter-label">{t('mailboxFilterLabel')}</span>
        <span className="list-filter-value list-filter-value--marked" title={activeLabel}>
          <AccountFilterMark accounts={accounts} account={displayAccount} />
          {activeLabel}
        </span>
        <button
          ref={triggerRef}
          type="button"
          className="list-filter-trigger"
          data-open={open}
          data-active={filter !== null}
          disabled={!selectable}
          aria-haspopup="menu"
          aria-expanded={selectable && open}
          aria-controls={menuId}
          aria-label={t('mailboxFilterAria', { name: activeLabel })}
          onClick={() => setOpen((current) => !current)}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 3h12L9.5 8.1v3.6l-3 1.3V8.1L2 3Z" />
          </svg>
        </button>

        {open && selectable && (
          <div
            ref={popoverRef}
            popover="manual"
            id={menuId}
            className="account-filter-menu"
            role="menu"
            aria-label={t('mailboxFilterLabel')}
            onKeyDown={moveWithinMenu}
          >
            <button
              type="button"
              role="menuitemradio"
              aria-checked={filter === null}
              aria-keyshortcuts="0"
              className="account-filter-option"
              onClick={() => select(null)}
            >
              <AccountFilterMark accounts={accounts} />
              <span className="account-filter-option__copy">
                <strong>{t('mailboxFilterAll')}</strong>
                <small>{t('mailboxFilterCount', { n: accounts.length })}</small>
              </span>
              <span className="account-filter-option__meta" aria-hidden="true">
                <kbd className="account-filter-hotkey">0</kbd>
                <span className="account-filter-check">{filter === null ? '✓' : ''}</span>
              </span>
            </button>
            {accounts.map((account, index) => {
              const hotkey = accountHotkeyForIndex(index)
              return (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={filter === account.id}
                  aria-keyshortcuts={hotkey ?? undefined}
                  className="account-filter-option"
                  key={account.id}
                  onClick={() => select(account.id)}
                >
                  <AccountFilterMark accounts={accounts} account={account} />
                  <span className="account-filter-option__copy">
                    <strong>{account.accountName}</strong>
                    <small>{account.email}</small>
                  </span>
                  <span className="account-filter-option__meta" aria-hidden="true">
                    {hotkey && <kbd className="account-filter-hotkey">{hotkey}</kbd>}
                    <span className="account-filter-check">{filter === account.id ? '✓' : ''}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/** Interval-getriebene Lade-Punkte (das Theme deaktiviert CSS-Keyframes). */
/**
 * Manueller Refresh: gleicht alle Konten sofort mit dem Server ab. Die INBOX
 * kommt per IDLE ohnehin live — der Knopf existiert vor allem für Ordner am
 * 10-Minuten-Poll (Spam!). Der Spin ist Klick-Feedback; neue Mails treffen
 * asynchron über messages:changed ein.
 */
function RefreshButton(): React.JSX.Element {
  const t = useT()
  const [spinning, setSpinning] = useState(false)
  const timerRef = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const refresh = (): void => {
    void invoke('sync:trigger', undefined).catch(() => {})
    setSpinning(true)
    window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setSpinning(false), 2500)
  }

  return (
    <button
      type="button"
      className="mailbox-refresh"
      data-spinning={spinning}
      onClick={refresh}
      title={t('refreshTitle')}
      aria-label={t('refreshTitle')}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M13.65 8a5.65 5.65 0 1 1-1.66-4" />
        <path d="M13.99 1.35v2.9h-2.9" />
      </svg>
    </button>
  )
}

function SendingDots(): React.JSX.Element {
  const [dots, setDots] = useState('…')
  useEffect(() => {
    const iv = setInterval(() => setDots((d) => (d.length >= 3 ? '.' : d + '.')), 320)
    return () => clearInterval(iv)
  }, [])
  return <>{dots}</>
}

function InboxList(): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const {
    view,
    setView,
    filter,
    setFilter,
    selThreadKey,
    setSelThreadKey,
    comp,
    hiddenThreads,
    mbox,
    setMbox,
    inboxFilters
  } = usePaper()

  // Klick auf eine Mail verlässt den Composer — das Getippte sichert er selbst als Entwurf
  const openThread = (threadKey: string): void => {
    setSelThreadKey(threadKey)
    if (view === 'compose') setView('inbox')
  }
  const threadsQuery = useThreads(filter, mbox)
  const counts = useMboxCounts(filter)
  const accounts = useAccounts()
  const listRef = useScrollToSelected(selThreadKey)
  const labels = useMemo(() => accountLabels(accounts.data ?? []), [accounts.data])
  const savedDrafts = useDrafts()
  const draftKeys = useMemo(
    () => new Set((savedDrafts.data ?? []).map((d) => d.threadKey)),
    [savedDrafts.data]
  )

  const allRows = useMemo(
    () => (threadsQuery.data ?? []).filter((r) => !hiddenThreads.has(r.threadKey)),
    [threadsQuery.data, hiddenThreads]
  )
  // 5c: Zähler immer über die UNGEFILTERTE Liste — ein Fetch, Filter im Renderer
  const inboxFilterCounts = useMemo(() => filterCounts(allRows), [allRows])
  // Aktive Filter wirken nur im EINGANG — in SENT/SPAM bleiben sie geparkt
  const rows = useMemo(
    () => (mbox === 'inbox' ? applyFilters(allRows, inboxFilters) : allRows),
    [allRows, inboxFilters, mbox]
  )
  const sel = rows.find((r) => r.threadKey === selThreadKey) ?? rows[0]

  // Optimistische Echos: frisch Gesendetes sofort anzeigen, bis die Server-Kopie da ist
  const echoes = useSendState((s) => s.echoes)
  const dropEcho = useSendState((s) => s.dropEcho)
  const sentEchoes = useMemo(
    () => (mbox === 'sent' ? echoes.filter((e) => !rows.some((r) => echoConfirmedBy(e, r))) : []),
    [mbox, echoes, rows]
  )
  useEffect(() => {
    if (mbox !== 'sent') return
    for (const e of echoes) {
      if (rows.some((r) => echoConfirmedBy(e, r))) dropEcho(e.outboxId)
    }
  }, [mbox, echoes, rows, dropEcho])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="inbox-controls">
        <AccountFilter
          accounts={accounts.data ?? []}
          loading={accounts.isLoading}
          filter={filter}
          onChange={setFilter}
        />
        <div className="flex items-stretch gap-1.5">
          <div
            className="mailbox-tabs min-w-0 flex-1"
            role="group"
            aria-label={t('mailboxTabsAria')}
          >
            {(
              [
                ['inbox', t('mboxInbox'), counts.data?.inbox],
                ['sent', t('mboxSent'), counts.data?.sent],
                ['spam', t('mboxSpam'), counts.data?.spam]
              ] as Array<['inbox' | 'sent' | 'spam', string, number | undefined]>
            ).map(([key, label, count], i) => {
              const active = mbox === key
              return (
                <button
                  type="button"
                  aria-pressed={active}
                  key={key}
                  onClick={() => setMbox(key)}
                  className="mailbox-tab"
                  data-first={i === 0}
                >
                  {label} <span>{count ?? ''}</span>
                </button>
              )
            })}
          </div>
          <RefreshButton />
        </div>
        {mbox === 'inbox' && (
          <div style={{ marginTop: 7 }}>
            <InboxFilterMenu counts={inboxFilterCounts} totalRows={allRows.length} />
          </div>
        )}
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {sentEchoes.map((e) => {
          const color = accounts.data?.find((a) => a.id === e.accountId)?.color ?? '#c3b8e0'
          const failed = e.state === 'error' || e.state === 'unknown'
          return (
            <div key={`echo-${e.outboxId}`} className="list-row" style={{ cursor: 'default' }}>
              <div className="flex items-baseline gap-1.5">
                <span style={badgeStyle(color)}>
                  {(labels.get(e.accountId) ?? '?').slice(0, 1)}
                </span>
                <span
                  className="min-w-0 truncate"
                  style={{ font: '400 13.5px var(--serif)', color: 'var(--secondary)' }}
                >
                  {t('toName', { name: e.toNames[0] ?? '—' })}
                </span>
                <span
                  className="mmeta ml-auto flex-none"
                  style={{ color: failed ? 'var(--ac)' : 'var(--muted)' }}
                >
                  {failed ? (
                    t(e.state === 'unknown' ? 'echoSendUnknown' : 'echoSendFailed')
                  ) : (
                    <>
                      {t('echoSending')}
                      <SendingDots />
                    </>
                  )}
                </span>
              </div>
              {e.state === 'unknown' && (
                <div style={{ font: '400 12px var(--serif)', color: 'var(--ac)', marginTop: 2 }}>
                  {t('echoSendUnknownHint')}
                </div>
              )}
              {e.subject.trim() && (
                <div
                  className="truncate"
                  style={{ font: '400 12px var(--serif)', color: '#8a8272', marginTop: 2 }}
                >
                  {e.subject}
                </div>
              )}
            </div>
          )
        })}
        {rows.map((r: ThreadListItem) => {
          const isSel = sel?.threadKey === r.threadKey
          const color = accounts.data?.find((a) => a.id === r.accountId)?.color ?? '#c3b8e0'
          const chipTask =
            r.suggestedTask && (r.taskState === 'suggested' || r.taskState === 'accepted')
          const chipDraft =
            (Boolean(comp.text.trim()) && comp.threadKey === r.threadKey) ||
            draftKeys.has(r.threadKey)
          return (
            <div
              key={r.threadKey}
              className="list-row"
              data-selected={isSel}
              onClick={() => openThread(r.threadKey)}
            >
              <div className="flex items-baseline gap-1.5">
                <PriorityTick aiPriority={r.aiPriority} />
                <span style={badgeStyle(color)}>
                  {(labels.get(r.accountId) ?? '?').slice(0, 1)}
                </span>
                <span
                  className="min-w-0 truncate"
                  style={{
                    font: `${r.unread ? 600 : 400} 13.5px var(--serif)`,
                    color: r.unread ? 'var(--ink)' : 'var(--secondary)'
                  }}
                >
                  {mbox === 'sent'
                    ? t('toName', { name: r.toNames[0] ?? r.subject ?? '—' })
                    : (r.fromNames[0] ?? r.subject ?? '—')}
                </span>
                {r.unread && (
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      background: 'var(--ac)',
                      flex: 'none',
                      display: 'inline-block'
                    }}
                  />
                )}
                <span className="mmeta ml-auto flex-none">{rowTime(lang, r.date)}</span>
              </div>
              {r.aiSummary && (
                <div
                  className="truncate"
                  style={{
                    font: '400 12px var(--serif)',
                    fontStyle: 'italic',
                    color: r.unread ? 'var(--secondary)' : '#8a8272',
                    marginTop: 2
                  }}
                >
                  ↳ {r.aiSummary}
                </div>
              )}
              {!r.aiSummary && r.subject && (
                <div
                  className="truncate"
                  style={{ font: '400 12px var(--serif)', color: '#8a8272', marginTop: 2 }}
                >
                  {r.subject}
                </div>
              )}
              {(chipTask || chipDraft) && (
                <div className="mt-1.5 flex gap-1.5">
                  {chipTask && (
                    <span
                      className="mchip"
                      style={{ color: 'var(--paper)', background: 'var(--ink)' }}
                    >
                      {t('chipTask')}
                      {r.suggestedTask?.due ? ` · ${r.suggestedTask.due.toUpperCase()}` : ''}
                    </span>
                  )}
                  {chipDraft && (
                    <span
                      className="mchip"
                      style={{
                        color: 'var(--ac)',
                        border: '1px solid var(--ac)',
                        padding: '0 5px'
                      }}
                    >
                      {t('chipDraftReady')}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        })}
        {rows.length === 0 &&
          sentEchoes.length === 0 &&
          !threadsQuery.isLoading &&
          (mbox === 'inbox' && inboxFilters.size > 0 ? (
            inboxFilters.size === 1 && inboxFilters.has('needsYou') ? (
              <Empty line={t('needsYouZero')} sub={t('needsYouZeroSub')} />
            ) : (
              <Empty line={t('filterZero')} sub={t('filterZeroSub')} />
            )
          ) : (
            <Empty line={t('inboxZero')} sub={t('inboxZeroSub')} />
          ))}
      </div>
    </div>
  )
}

function WaitingList(): React.JSX.Element {
  const t = useT()
  const followups = useFollowups()
  const { selWaitingId, setSelWaitingId } = usePaper()
  const items = followups.data ?? []
  const sel = items.find((w) => w.messageId === selWaitingId) ?? items[0]
  const listRef = useScrollToSelected(selWaitingId)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header left={t('waitingHead')} right={t('waitingSub')} />
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {items.map((w) => (
          <div
            key={w.messageId}
            className="list-row"
            style={{ padding: '11px 18px' }}
            data-selected={sel?.messageId === w.messageId}
            onClick={() => setSelWaitingId(w.messageId)}
          >
            <div className="flex items-baseline gap-1.5">
              <span style={{ font: '600 13.5px var(--serif)' }} className="min-w-0 truncate">
                {w.toAddrs[0] ?? '—'}
              </span>
              <span
                className="ml-auto flex-none"
                style={{ font: '500 9.5px var(--mono)', color: 'var(--ac)' }}
              >
                {w.daysWaiting === 0 ? t('today') : t('daysSilent', { d: w.daysWaiting })}
              </span>
            </div>
            <div
              className="truncate"
              style={{
                font: '400 12px var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                marginTop: 2
              }}
            >
              ↳ {w.subject ?? '—'}
            </div>
            {nudgedToday(w.nudgedAt) && (
              <div style={{ marginTop: 4 }}>
                <span
                  style={{
                    font: '500 8.5px var(--mono)',
                    color: 'var(--muted)',
                    border: '1px solid var(--hairline)',
                    padding: '1px 6px'
                  }}
                >
                  {t('nudgedToday')}
                </span>
              </div>
            )}
          </div>
        ))}
        {items.length === 0 && <Empty line={t('waitingEmpty')} sub={t('waitingEmptySub')} />}
      </div>
    </div>
  )
}

function TasksList(): React.JSX.Element {
  const t = useT()
  const openTasks = useTasks('open')
  const doneTasks = useTasks('done')
  const {
    selTaskId,
    setSelTaskId,
    showOpenTasks,
    setShowOpenTasks,
    showCompletedTasks,
    setShowCompletedTasks,
    toastNow
  } = usePaper()
  const openRows = openTasks.data?.tasks ?? []
  const completedRows = doneTasks.data?.tasks ?? []
  const completedCount = completedRows.filter((task) => task.status === 'done').length
  const visibility = { open: showOpenTasks, done: showCompletedTasks }
  const all = visibleTaskRows(openRows, completedRows, visibility)
  const sel = all.find((x) => x.id === selTaskId) ?? all[0]
  const listRef = useScrollToSelected(selTaskId)
  const toggle = (id: number, status: string): void => {
    // Der Wechsel kann die Aufgabe aus der gefilterten Liste nehmen — dann
    // rückt die Auswahl auf den sichtbaren Nachbarn weiter.
    const becomesDone = status !== 'done'
    const willDisappear = becomesDone ? !showCompletedTasks : !showOpenTasks
    const shouldReconcileSelection = willDisappear && sel?.id === id
    const nextTaskId = shouldReconcileSelection
      ? taskIdAfterCompletion(becomesDone ? openRows : all, id)
      : null
    const selectionAtStart = usePaper.getState().selTaskId

    void invoke('tasks:update', { id, status: status === 'done' ? 'open' : 'done' })
      .then(() => {
        if (shouldReconcileSelection && usePaper.getState().selTaskId === selectionAtStart) {
          setSelTaskId(nextTaskId)
        }
      })
      .catch(() => toastNow(t('toastTaskUpdateFailed')))
  }
  const setStatusVisibility = (next: { open: boolean; done: boolean }): void => {
    const nextRows = visibleTaskRows(openRows, completedRows, next)
    setSelTaskId(taskIdAfterVisibilityChange(nextRows, selTaskId))
    setShowOpenTasks(next.open)
    setShowCompletedTasks(next.done)
  }
  const nothingSelected = !showOpenTasks && !showCompletedTasks
  const onlyHiddenCompletedTasks =
    showOpenTasks && !showCompletedTasks && openRows.length === 0 && completedCount > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header
        left={t('tasksHead')}
        right={
          <TaskStatusFilter
            openCount={openRows.length}
            completedCount={completedCount}
            showOpen={showOpenTasks}
            showCompleted={showCompletedTasks}
            onShowOpenChange={(show) =>
              setStatusVisibility({ open: show, done: showCompletedTasks })
            }
            onShowCompletedChange={(show) =>
              setStatusVisibility({ open: showOpenTasks, done: show })
            }
          />
        }
      />
      <div id="tasks-list-rows" ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
        {all.map((task) => {
          const done = task.status === 'done'
          return (
            <div
              key={task.id}
              className="list-row"
              style={{ padding: '11px 18px' }}
              data-selected={sel?.id === task.id}
              onClick={() => setSelTaskId(task.id)}
            >
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  className="checkbox-square"
                  aria-pressed={done}
                  aria-label={done ? t('spaceReopen') : t('spaceDone')}
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(task.id, task.status)
                  }}
                >
                  {done && <div style={{ width: 6, height: 6, background: 'var(--ink)' }} />}
                </button>
                <span
                  className="min-w-0 flex-1 truncate"
                  style={{
                    font: '400 13.5px var(--serif)',
                    ...(done
                      ? { textDecoration: 'line-through', color: 'var(--faint)' }
                      : { color: 'var(--ink)' })
                  }}
                >
                  {task.title}
                </span>
                <TaskSyncGlyph state={task.syncState} />
                {task.dueDate && (
                  <span
                    className="mchip flex-none"
                    style={
                      done
                        ? { color: 'var(--faint)', border: '1px solid var(--hairline-light)' }
                        : {
                            color: 'var(--paper)',
                            background: 'var(--ac)',
                            border: '1px solid var(--ac)'
                          }
                    }
                  >
                    {task.dueDate.toUpperCase()}
                  </span>
                )}
              </div>
              {task.sourceSubject && (
                <div
                  className="truncate"
                  style={{
                    font: '400 11px var(--serif)',
                    fontStyle: 'italic',
                    color: 'var(--faint)',
                    marginTop: 3,
                    paddingLeft: 22
                  }}
                >
                  {t('taskFrom', { src: task.sourceSubject })}
                </div>
              )}
            </div>
          )
        })}
        {all.length === 0 && (
          <Empty
            line={
              nothingSelected
                ? t('tasksFilterNothing')
                : onlyHiddenCompletedTasks
                  ? t('tasksAllDone')
                  : t('tasksEmpty')
            }
            sub={
              nothingSelected
                ? t('tasksFilterNothingSub')
                : onlyHiddenCompletedTasks
                  ? t('tasksAllDoneSub')
                  : t('tasksEmptySub')
            }
          />
        )}
      </div>
    </div>
  )
}

function SettingsList(): React.JSX.Element {
  const t = useT()
  const { setSel, setSetSel } = usePaper()
  const accounts = useAccounts()
  const orStatus = useOrKeyStatus()
  const models = useModels()

  const short = (id: string | undefined): string => (id ? id.split('/')[1] : '—')
  const rows: Array<{ id: SettingsSection; name: string; sub: string }> = [
    {
      id: 'accounts',
      name: t('setAccounts'),
      sub: t('setAccountsSub', { n: accounts.data?.length ?? 0 })
    },
    { id: 'style', name: t('setStyle'), sub: t('setStyleSub') },
    { id: 'sig', name: t('setSig'), sub: t('setSigSub') },
    {
      id: 'intel',
      name: t('setIntel'),
      sub: orStatus.data?.hasKey
        ? t('setIntelSub', {
            scan: short(models.data?.scanModel),
            write: short(models.data?.writeModel)
          })
        : t('setIntelSubNoKey')
    },
    { id: 'tech', name: t('setTech'), sub: t('setTechSub') }
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header left={t('settingsHead')} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map((r) => (
          <div
            key={r.id}
            className="list-row"
            style={{ padding: '11px 18px' }}
            data-selected={setSel === r.id}
            onClick={() => setSetSel(r.id)}
          >
            <div style={{ font: '600 13.5px var(--serif)' }}>{r.name}</div>
            <div
              className="truncate"
              style={{
                font: '400 12px var(--serif)',
                fontStyle: 'italic',
                color: 'var(--secondary)',
                marginTop: 2
              }}
            >
              ↳ {r.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ListPane(): React.JSX.Element {
  const t = useT()
  const { view, filter, hiddenThreads, mbox } = usePaper()
  const threadsQuery = useThreads(filter, mbox)
  const followups = useFollowups()
  const openTasks = useTasks('open')
  const doneTasks = useTasks('done')

  // j/k (und Pfeile) aus der Keymap: Auswahl in der aktiven Liste bewegen
  useEffect(() => {
    const onMove = (e: Event): void => {
      const dir = (e as CustomEvent<number>).detail
      const st = usePaper.getState()
      const clamp = (i: number, len: number): number => Math.max(0, Math.min(len - 1, i))
      if (st.view === 'inbox') {
        const rows = (threadsQuery.data ?? []).filter((r) => !hiddenThreads.has(r.threadKey))
        if (rows.length === 0) return
        const cur = rows.findIndex((r) => r.threadKey === st.selThreadKey)
        const next = rows[clamp((cur === -1 ? 0 : cur) + dir, rows.length)]
        st.setSelThreadKey(next.threadKey)
      } else if (st.view === 'waiting') {
        const rows = followups.data ?? []
        if (rows.length === 0) return
        const cur = rows.findIndex((r) => r.messageId === st.selWaitingId)
        st.setSelWaitingId(rows[clamp((cur === -1 ? 0 : cur) + dir, rows.length)].messageId)
      } else if (st.view === 'tasks') {
        const rows = visibleTaskRows(openTasks.data?.tasks ?? [], doneTasks.data?.tasks ?? [], {
          open: st.showOpenTasks,
          done: st.showCompletedTasks
        })
        if (rows.length === 0) return
        const cur = rows.findIndex((r) => r.id === st.selTaskId)
        st.setSelTaskId(rows[clamp((cur === -1 ? 0 : cur) + dir, rows.length)].id)
      } else if (st.view === 'settings') {
        const order = ['accounts', 'style', 'sig', 'intel', 'tech'] as const
        const cur = order.indexOf(st.setSel)
        st.setSetSel(order[clamp(cur + dir, order.length)])
      }
    }
    window.addEventListener('paper:move', onMove)
    return () => window.removeEventListener('paper:move', onMove)
  }, [threadsQuery.data, followups.data, openTasks.data, doneTasks.data, hiddenThreads, mbox])
  return (
    <div className="flex min-h-0 w-[400px] flex-none flex-col border-r border-ink">
      {(view === 'inbox' || view === 'compose') && <InboxList />}
      {view === 'waiting' && <WaitingList />}
      {view === 'tasks' && <TasksList />}
      {view === 'calendar' && <CalendarSidebar />}
      {view === 'chat' && <OwlConversationsPane />}
      {view === 'settings' && <SettingsList />}
      <div
        className="flex flex-none items-baseline gap-3 border-t border-ink"
        style={{ padding: '10px 18px', font: '400 9.5px var(--mono)', color: 'var(--muted)' }}
      >
        {view === 'calendar' ? (
          <>
            <span>
              <span style={{ color: 'var(--ink)' }}>d/w/m</span> {t('cvKeyView')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>t</span> {t('cvKeyToday')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>n</span> {t('cvKeyNew')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>?</span> {t('keyKeys')}
            </span>
          </>
        ) : view === 'chat' ? (
          <>
            <span>
              <span style={{ color: 'var(--ink)' }}>j/k</span> {t('keyMove')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>↵</span> {t('owlKeyOpen')}
            </span>
            <button
              type="button"
              className="owl-key-btn"
              onClick={() => {
                // Die NEUE-FRAGE-Affordanz der Spalte: leert das Blatt, fokussiert das Feld
                useOwl.getState().newQuestion()
                useOwl.getState().requestFocus()
              }}
            >
              <span style={{ color: 'var(--ink)' }}>n</span> {t('owlKeyNew')}
            </button>
            <span>
              <span style={{ color: 'var(--ink)' }}>?</span> {t('keyKeys')}
            </span>
          </>
        ) : (
          <>
            <span>
              <span style={{ color: 'var(--ink)' }}>j/k</span> {t('keyMove')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>e</span> {t('keyFile')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>⌘D</span> {t('keyDictate')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>i</span> {t('keyNeedsYou')}
            </span>
            <span>
              <span style={{ color: 'var(--ink)' }}>?</span> {t('keyKeys')}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
