import { useEffect, useMemo, useRef, useState } from 'react'
import { usePaper } from '@renderer/stores/paper'
import { useOwl } from '@renderer/stores/owl'
import { useI18n, useT } from '@renderer/lib/i18n'
import { invoke } from '@renderer/lib/ipc'
import { useThreads } from '@renderer/queries/threads'
import { useFollowups } from '@renderer/queries/followups'
import { useAccounts } from '@renderer/queries/accounts'
import { useUiStore } from '@renderer/stores/ui'
import { accountLabels } from '@renderer/lib/accountLabels'
import { accountHotkeyForIndex } from '@renderer/keyboard/account-hotkeys'
import { useDictation } from '@renderer/lib/useDictation'
import { DictationStrip } from '@renderer/components/DictationStrip'
import {
  reconcilePaletteSelection,
  routePaletteQuery
} from '@renderer/features/search/palette-router'

interface Cmd {
  id: string
  label: string
  note: string
  /** Tasten-Badge — leer lassen, wenn es keinen Shortcut gibt. */
  key?: string
  act: () => void
}

export function PaperPalette(): React.JSX.Element | null {
  const paletteOpen = usePaper((state) => state.paletteOpen)
  return paletteOpen ? <PaperPaletteOpen /> : null
}

function PaperPaletteOpen(): React.JSX.Element {
  const t = useT()
  const { lang, setLang } = useI18n()
  const paper = usePaper()
  const threads = useThreads(paper.filter, paper.mbox)
  const followups = useFollowups()
  const accounts = useAccounts()
  const setAddAccountOpen = useUiStore((s) => s.setAddAccountOpen)
  const [q, setQ] = useState('')
  const [selection, setSelection] = useState<{ id: string | null; manual: boolean }>({
    id: null,
    manual: false
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const dictation = useDictation({
    onText: (text) => {
      setQ(text)
      setSelection({ id: null, manual: false })
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    onError: (message) => paper.toastNow(message)
  })

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  const cmds = useMemo((): Cmd[] => {
    const sel = threads.data?.find((th) => th.threadKey === paper.selThreadKey) ?? threads.data?.[0]
    const list: Cmd[] = []
    for (const w of followups.data ?? []) {
      list.push({
        id: `nudge:${w.messageId}`,
        label: t('cmdReviewNudge', { name: w.toAddrs[0] ?? '?' }),
        note: w.daysWaiting === 0 ? t('today') : t('daysSilent', { d: w.daysWaiting }),
        key: '↵',
        act: () => {
          paper.setView('waiting')
          paper.setSelWaitingId(w.messageId)
        }
      })
    }
    if (sel) {
      if (paper.mbox === 'inbox') {
        list.push({
          id: 'dictate',
          label: t('cmdDictate', { name: sel.fromNames[0] ?? '?' }),
          note: t('cmdHeroMove'),
          key: '⌘D',
          act: () => {
            paper.setView('inbox')
            window.dispatchEvent(new CustomEvent('paper:mail', { detail: 'dictate' }))
          }
        })
      }
      list.push({
        id: 'summarize',
        label: t('cmdSummarize'),
        note: t('cmdOwlsGist'),
        key: '⇧s',
        act: () => window.dispatchEvent(new CustomEvent('paper:mail', { detail: 'summarize' }))
      })
      if (paper.mbox === 'inbox' && sel.taskState === 'suggested') {
        list.push({
          id: 'task-accept',
          label: t('cmdAcceptTask'),
          note: sel.suggestedTask?.due ?? '',
          key: 't',
          act: () => window.dispatchEvent(new CustomEvent('paper:mail', { detail: 'taskAccept' }))
        })
      }
    }
    list.push({
      id: 'compose',
      label: t('cmdCompose'),
      note: '',
      key: '⌘N',
      act: () => paper.setView('compose')
    })
    list.push({
      id: 'go-inbox',
      label: t('cmdGoInbox'),
      note: '',
      key: '⌘1',
      act: () => paper.setView('inbox')
    })
    list.push({
      id: 'go-waiting',
      label: t('cmdGoWaiting'),
      note: t('cmdOpen', { n: followups.data?.length ?? 0 }),
      key: '⌘2',
      act: () => paper.setView('waiting')
    })
    list.push({
      id: 'go-tasks',
      label: t('cmdGoTasks'),
      note: '',
      key: '⌘3',
      act: () => paper.setView('tasks')
    })
    list.push({
      id: 'style',
      label: t('cmdYourStyle'),
      note: t('cmdOnePerAddress'),
      act: () => {
        paper.setView('settings')
        paper.setSetSel('style')
      }
    })
    list.push({
      id: 'signature',
      label: t('cmdSig'),
      note: t('cmdSigNote'),
      key: '',
      act: () => {
        paper.setView('settings')
        paper.setSetSel('sig')
      }
    })
    const labels = accountLabels(accounts.data ?? [])
    list.push({
      id: 'account:all',
      label: t('cmdFilterAll'),
      note: '',
      key: '0',
      act: () => paper.setFilter(null)
    })
    ;(accounts.data ?? []).forEach((a, index) => {
      list.push({
        id: `account:${a.id}`,
        label: t('cmdFilterOnly', { name: (labels.get(a.id) ?? '?').toLowerCase() }),
        note: '',
        key: accountHotkeyForIndex(index) ?? '',
        act: () => paper.setFilter(a.id)
      })
    })
    list.push({
      id: 'folder-inbox',
      label: t('cmdFolderInbox'),
      note: '',
      key: '',
      act: () => {
        paper.setView('inbox')
        paper.setMbox('inbox')
      }
    })
    list.push({
      id: 'folder-sent',
      label: t('cmdFolderSent'),
      note: '',
      key: '',
      act: () => {
        paper.setView('inbox')
        paper.setMbox('sent')
      }
    })
    list.push({
      id: 'folder-spam',
      label: t('cmdFolderSpam'),
      note: t('cmdFolderSpamNote'),
      key: '',
      act: () => {
        paper.setView('inbox')
        paper.setMbox('spam')
      }
    })
    list.push({
      id: 'refresh',
      label: t('cmdRefresh'),
      note: t('cmdRefreshNote'),
      key: '',
      act: () => {
        void invoke('sync:trigger', undefined).catch(() => {})
        paper.toastNow(t('toastRefreshing'))
      }
    })
    list.push({
      id: 'settings',
      label: t('cmdOpenSettings'),
      note: t('cmdSettingsNote'),
      key: '⌘,',
      act: () => paper.setView('settings')
    })
    list.push({
      id: 'add-account',
      label: t('cmdAddAddress'),
      note: t('cmdProviders'),
      key: '',
      act: () => setAddAccountOpen(true)
    })
    list.push({
      id: 'models',
      label: t('cmdChooseModels'),
      note: '',
      key: '',
      act: () => {
        paper.setView('settings')
        paper.setSetSel('intel')
      }
    })
    list.push({
      id: 'tech',
      label: t('cmdTech'),
      note: t('cmdTechNote'),
      key: '',
      act: () => {
        paper.setView('settings')
        paper.setSetSel('tech')
      }
    })
    list.push({
      id: 'owl-search',
      label: t('cmdOwlSearch'),
      note: t('cmdOwlSearchNote'),
      key: '/',
      act: () => {
        // Brücke für die alte Muskelerinnerung: Mailsuche wohnt jetzt bei der Eule
        paper.setView('chat')
        useOwl.getState().requestFocus()
      }
    })
    list.push({
      id: 'shortcuts',
      label: t('cmdShortcuts'),
      note: '',
      key: '?',
      act: () => paper.setHelpOpen(true)
    })
    list.push({
      id: 'language',
      label: t('cmdLanguage'),
      note: '',
      key: '',
      act: () => {
        setLang(lang === 'de' ? 'en' : 'de')
        paper.toastNow(t('toastLangSwitched'))
      }
    })
    list.push({
      id: 'onboarding',
      label: t('cmdReplayOnboarding'),
      note: '',
      key: '',
      act: () => paper.setOnboarding(true)
    })
    return list
  }, [threads.data, followups.data, accounts.data, paper, t, lang, setLang, setAddAccountOpen])

  // Seit die Mailsuche in der Owl-View lebt (/), filtert die Palette nur noch
  // Befehle — kein Mode-Routing, keine Debounce, keine Skeletons.
  const route = useMemo(() => routePaletteQuery(q, cmds), [cmds, q])

  const commandById = useMemo(() => new Map(cmds.map((command) => [command.id, command])), [cmds])
  const entries = route.commandIds
    .map((id) => commandById.get(id))
    .filter((command): command is Cmd => Boolean(command))
    .slice(0, 10)
    .map((command) => ({ id: `command:${command.id}`, command }))

  const visibleSelection = reconcilePaletteSelection(
    selection,
    entries.map((entry) => entry.id)
  )

  const activeIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.id === visibleSelection.id)
  )
  const activeEntry = entries[activeIndex]

  const run = (entry: { command: Cmd }): void => {
    paper.setPaletteOpen(false)
    entry.command.act()
  }

  const moveSelection = (delta: -1 | 1): void => {
    if (entries.length === 0) return
    const nextIndex = Math.max(0, Math.min(entries.length - 1, activeIndex + delta))
    setSelection({ id: entries[nextIndex].id, manual: true })
  }

  const renderCommandSection = (): React.JSX.Element => (
    <section className="palette-section" aria-labelledby="palette-commands-label">
      <div id="palette-commands-label" className="palette-section__label">
        {t('palCommandSection')}
      </div>
      {entries.length > 0 ? (
        entries.map((entry) => {
          const active = entry.id === activeEntry?.id
          return (
            <button
              type="button"
              id={`palette-option-${entry.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
              role="option"
              aria-selected={active}
              key={entry.id}
              className="palette-command-row"
              data-active={active}
              onMouseEnter={() => setSelection({ id: entry.id, manual: true })}
              onClick={() => run(entry)}
            >
              <span className="palette-command-row__label">{entry.command.label}</span>
              {entry.command.note && (
                <span className="palette-command-row__note">{entry.command.note}</span>
              )}
              {entry.command.key && (
                <span className="palette-command-row__key">{entry.command.key}</span>
              )}
            </button>
          )
        })
      ) : (
        <div className="palette-section__empty">{t('palNoCommands')}</div>
      )}
    </section>
  )

  return (
    <div className="scrim" onClick={() => paper.setPaletteOpen(false)}>
      <div
        className="overlay-card palette-card"
        role="dialog"
        aria-modal="true"
        aria-label={t('palAria')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="palette-input-row">
          <span className="palette-input-row__prompt" aria-hidden="true">
            ›
          </span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setSelection({ id: null, manual: false })
            }}
            onKeyDown={(e) => {
              // Einsprechen: ⌘D startet/beendet, Enter beendet, Esc verwirft
              if ((e.metaKey || e.ctrlKey) && (e.key === 'd' || e.key === 'D')) {
                e.preventDefault()
                e.stopPropagation()
                if (dictation.state === 'listening') dictation.finish()
                else if (dictation.state === 'idle') dictation.start()
                return
              }
              if (dictation.state === 'listening') {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  dictation.finish()
                } else if (e.key === 'Escape') {
                  dictation.cancel()
                }
                e.stopPropagation()
                return
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                moveSelection(1)
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                moveSelection(-1)
              } else if (e.key === 'Enter') {
                e.preventDefault()
                if (activeEntry) run(activeEntry)
              } else if (e.key === 'Escape') {
                paper.setPaletteOpen(false)
              }
              e.stopPropagation()
            }}
            role="combobox"
            aria-autocomplete="list"
            aria-controls="palette-results"
            aria-expanded="true"
            aria-activedescendant={
              activeEntry
                ? `palette-option-${activeEntry.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
                : undefined
            }
            placeholder={t('palPlaceholder')}
            className="palette-input-row__input"
          />
          {route.forcedCommands && (
            <span className="palette-input-row__mode">{t('palCommandMode')}</span>
          )}
          <button
            type="button"
            onClick={() =>
              dictation.state === 'listening' ? dictation.finish() : dictation.start()
            }
            className="btn-bare hit-target"
            title={t('voiceQueryStart')}
            aria-label={t('voiceQueryStart')}
            aria-pressed={dictation.state === 'listening'}
            style={{
              font: '500 10px var(--mono)',
              color: dictation.state === 'listening' ? 'var(--ac)' : 'var(--muted)'
            }}
          >
            ◉ ⌘D
          </button>
          <span className="palette-input-row__esc">ESC</span>
        </div>
        <DictationStrip
          state={dictation.state}
          seconds={dictation.seconds}
          bars={dictation.bars}
          onFinish={dictation.finish}
        />
        <div id="palette-results" role="listbox" className="palette-results">
          {renderCommandSection()}
        </div>
        <div className="palette-footer">
          <span>{t('palChoose')}</span>
          <span>{t('palRun')}</span>
          <span className="palette-footer__index">{t('palFooterOwl')}</span>
        </div>
      </div>
    </div>
  )
}

export function HelpOverlay(): React.JSX.Element | null {
  const t = useT()
  const { helpOpen, setHelpOpen } = usePaper()
  if (!helpOpen) return null

  const rows: Array<[string, string]> = [
    ['j / k', t('helpMove')],
    ['⌘D', t('helpDictate')],
    ['e', t('helpFile')],
    ['↵', t('helpEnter')],
    ['⌘↵', t('helpSend')],
    ['r', t('helpReply')],
    ['a', t('helpReplyAll')],
    ['⌘⇧A', t('helpReplyScopeToggle')],
    ['⇧r', t('helpRedraft')],
    ['⌘J', t('helpIdeaToMail')],
    ['t / x', t('helpTask')],
    ['l', t('helpOverride')],
    ['⇧s', t('helpSummarize')],
    ['z', t('helpUndo')],
    ['0 / 1…9', t('helpFilter')],
    ['/', t('helpSearch')],
    ['⌘k', t('helpPalette')],
    ['⌘1/2/3', t('helpViews')],
    ['⌘,', t('helpSettings')]
  ]

  return (
    <div className="scrim" onClick={() => setHelpOpen(false)}>
      <div
        className="overlay-card"
        style={{ width: 660, margin: '56px auto 0', padding: '22px 26px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline gap-2.5">
          <span style={{ font: '500 19px var(--serif)' }}>{t('helpTitle')}</span>
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>{t('helpSub')}</span>
        </div>
        <div className="grid grid-cols-2" style={{ gap: '4px 34px', marginTop: 16 }}>
          {rows.map(([k, desc]) => (
            <div
              key={k}
              className="flex items-baseline gap-2.5 border-b border-hairline2"
              style={{ padding: '5px 0' }}
            >
              <span className="kbd flex-none">{k}</span>
              <span style={{ font: '400 13px var(--serif)', color: 'var(--secondary)' }}>
                {desc}
              </span>
            </div>
          ))}
          {/* 5a-Legende: was die Rang-Ticks in der Liste bedeuten */}
          <div
            className="flex items-center gap-2.5"
            style={{ padding: '7px 0 2px', font: '400 10px var(--mono)', color: 'var(--muted)' }}
          >
            <span
              aria-hidden="true"
              style={{ width: 3, height: 9, background: 'var(--ac)', flex: 'none' }}
            />
            <span>{t('helpPrio5')}</span>
          </div>
          <div
            className="flex items-center gap-2.5"
            style={{ padding: '2px 0', font: '400 10px var(--mono)', color: 'var(--muted)' }}
          >
            <span
              aria-hidden="true"
              style={{ width: 3, height: 9, background: 'var(--ink)', flex: 'none' }}
            />
            <span>{t('helpPrio4')}</span>
          </div>
        </div>
        <div
          style={{
            font: '400 11.5px var(--serif)',
            fontStyle: 'italic',
            color: 'var(--faint)',
            marginTop: 14
          }}
        >
          {t('helpSignoff')}
        </div>
      </div>
    </div>
  )
}
