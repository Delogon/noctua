import { invoke } from '@renderer/lib/ipc'
import { useTasks } from '@renderer/queries/tasks'
import { useFollowups } from '@renderer/queries/followups'
import { useThreads } from '@renderer/queries/threads'
import { useAccounts } from '@renderer/queries/accounts'
import { useDrafts } from '@renderer/queries/drafts'
import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import { useVoiceTag } from '@renderer/features/paper/useVoiceTag'
import { removeDraft } from '@renderer/features/paper/draft-autosave'
import { useOrKeyStatus } from '@renderer/queries/intel'
import { OwlGlyph, type OwlPose } from '@renderer/components/paper/OwlGlyph'
import { RailAgenda } from '@renderer/features/calendar/RailAgenda'

const RAIL_DRAFT_LIMIT = 5

/** Zweite nicht-leere Zeile (nach der Anrede), sonst die erste. */
function draftExcerptOf(text: string): string {
  return text.split('\n').filter((l) => l.trim())[1] ?? text.split('\n')[0] ?? ''
}

interface RailDraft {
  threadKey: string
  name: string
  excerpt: string
  live: boolean
}

function RailCard({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="rail-card flex-none" style={{ padding: '11px 13px' }}>
      {children}
    </div>
  )
}

/**
 * Pose der Rail-Eule aus Composer-Zustand und Schlüssel-Status (Turn 4b):
 * Diktat → listen, Transkription/Entwurf → scan, kein Schlüssel → asleep,
 * sonst awake (blinzelt live).
 */
// eslint-disable-next-line react-refresh/only-export-components -- Reine Hilfsfunktion, von Tests importiert
export function railOwlPose(compMode: string, hasKey: boolean | undefined): OwlPose {
  if (compMode === 'listening') return 'listen'
  if (compMode === 'transcribing' || compMode === 'drafting') return 'scan'
  if (hasKey === false) return 'asleep'
  return 'awake'
}

export function OwlRail(): React.JSX.Element {
  const t = useT()
  const { comp, setView, setMbox, setSelThreadKey, setSelWaitingId, filter, mbox, resetComp } =
    usePaper()
  const toastNow = usePaper((s) => s.toastNow)
  const tasks = useTasks('open')
  const followups = useFollowups()
  const activeThreads = useThreads(filter, mbox)
  const inboxThreads = useThreads(filter, 'inbox')
  const accounts = useAccounts()
  const savedDrafts = useDrafts()

  const selThread =
    activeThreads.data?.find((th) => th.threadKey === usePaper.getState().selThreadKey) ??
    activeThreads.data?.[0]
  const account = accounts.data?.find((a) => a.id === selThread?.accountId) ?? accounts.data?.[0]
  const voiceNote = useVoiceTag(account?.id ?? null, account?.accountName ?? null)

  const compThread = comp.threadKey
    ? inboxThreads.data?.find((th) => th.threadKey === comp.threadKey)
    : undefined

  // Live-Puffer zuerst, dahinter alle gespeicherten Entwürfe (jüngste zuerst).
  const liveKey = comp.text.trim() ? comp.threadKey : null
  const railDrafts: RailDraft[] = []
  if (liveKey) {
    const savedSelf = savedDrafts.data?.find((d) => d.threadKey === liveKey)
    railDrafts.push({
      threadKey: liveKey,
      name:
        compThread?.fromNames[0] ??
        savedSelf?.displayName ??
        compThread?.subject ??
        savedSelf?.subject ??
        '?',
      excerpt: draftExcerptOf(comp.text),
      live: true
    })
  }
  for (const d of savedDrafts.data ?? []) {
    if (d.threadKey === liveKey) continue
    railDrafts.push({
      threadKey: d.threadKey,
      name: d.displayName ?? d.subject ?? '?',
      excerpt: draftExcerptOf(d.text),
      live: false
    })
  }

  const openDraft = (threadKey: string): void => {
    setMbox('inbox')
    setView('inbox')
    setSelThreadKey(threadKey)
  }

  const deleteRailDraft = (d: RailDraft): void => {
    // Erst den Puffer leeren (löst die Sicherung aus), dann löschen — die
    // IPC-Reihenfolge stellt sicher, dass das Löschen zuletzt gewinnt.
    if (usePaper.getState().comp.threadKey === d.threadKey) resetComp()
    removeDraft(d.threadKey)
    toastNow(t('toastDraftDeleted'))
  }

  const openTasks = (tasks.data?.tasks ?? []).slice(0, 3)
  const waiting = followups.data ?? []

  const orStatus = useOrKeyStatus()
  const railPose = railOwlPose(comp.mode, orStatus.data?.ready)
  const owlStatus =
    comp.mode === 'listening'
      ? t('owlListening')
      : comp.mode === 'transcribing' || comp.mode === 'drafting'
        ? t('owlDraftingS')
        : railPose === 'asleep'
          ? t(orStatus.data?.block === 'local-only' ? 'owlAsleepLocalOnly' : 'owlAsleepNoKey')
          : t('owlQuiet')

  return (
    <div
      className="flex w-[290px] flex-none flex-col gap-[11px] overflow-y-auto border-l border-ink"
      style={{ background: 'var(--rail)', padding: '14px 15px 12px', boxSizing: 'border-box' }}
    >
      <div className="flex flex-none items-baseline gap-2">
        <span style={{ alignSelf: 'center', display: 'inline-flex' }}>
          <OwlGlyph size={17} live pose={railPose} />
        </span>
        <span className="mlabel" style={{ letterSpacing: 2, color: 'var(--ac)' }}>
          {t('theOwl')}
        </span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>{owlStatus}</span>
      </div>

      <RailCard>
        <div className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('railDrafts')}
        </div>
        {railDrafts.length > 0 ? (
          <>
            {railDrafts.slice(0, RAIL_DRAFT_LIMIT).map((d, i) => (
              <div
                key={d.threadKey}
                style={
                  i > 0 ? { marginTop: 10, borderTop: '1px solid var(--hairline)' } : undefined
                }
              >
                <div className="flex items-baseline gap-2" style={{ marginTop: i > 0 ? 9 : 8 }}>
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ font: '500 12.5px var(--serif)' }}
                  >
                    {t('railReplyTo', { name: d.name })}
                  </span>
                  <button
                    type="button"
                    onClick={() => deleteRailDraft(d)}
                    className="btn-bare hit-target flex-none"
                    title={t('railDraftDelete')}
                    aria-label={t('railDraftDelete')}
                    style={{ font: '500 12px var(--mono)', color: 'var(--muted)' }}
                  >
                    ×
                  </button>
                </div>
                <div
                  style={{
                    font: '400 11.5px var(--serif)',
                    fontStyle: 'italic',
                    color: 'var(--secondary)',
                    marginTop: 3
                  }}
                >
                  “{d.excerpt}”
                </div>
                <div className="flex gap-2.5" style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    onClick={() => openDraft(d.threadKey)}
                    className="btn-bare"
                    style={{
                      font: '500 9px var(--mono)',
                      color: 'var(--paper)',
                      background: 'var(--ink)',
                      padding: '3px 9px'
                    }}
                  >
                    {t('railReview')}
                  </button>
                </div>
              </div>
            ))}
            {railDrafts.length > RAIL_DRAFT_LIMIT && (
              <div style={{ font: '400 9px var(--mono)', color: 'var(--faint)', marginTop: 9 }}>
                {t('railDraftMore', { n: railDrafts.length - RAIL_DRAFT_LIMIT })}
              </div>
            )}
          </>
        ) : (
          <div
            style={{
              font: '400 11.5px/1.55 var(--serif)',
              fontStyle: 'italic',
              color: 'var(--faint)',
              marginTop: 8
            }}
          >
            {t('railDraftNone').replace('{v}', '⌘D')}
          </div>
        )}
      </RailCard>

      <RailCard>
        <div className="flex items-baseline">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('railTasksHead')}
          </span>
          <button
            type="button"
            onClick={() => setView('tasks')}
            className="btn-bare ml-auto"
            style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}
          >
            {t('railOpenArrow', { n: tasks.data?.tasks.length ?? 0 })}
          </button>
        </div>
        {openTasks.map((task) => (
          <div key={task.id} className="flex items-center gap-2" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="checkbox-square"
              style={{ width: 11, height: 11 }}
              aria-pressed={false}
              aria-label={t('spaceDone')}
              onClick={() => void invoke('tasks:update', { id: task.id, status: 'done' })}
            />
            <span
              className="min-w-0 flex-1 truncate"
              style={{ font: '400 12px var(--serif)', color: 'var(--ink)' }}
            >
              {task.title}
            </span>
            {task.dueDate && (
              <span
                className="flex-none"
                style={{
                  font: '500 8px var(--mono)',
                  color: 'var(--paper)',
                  background: 'var(--ac)',
                  padding: '1px 5px'
                }}
              >
                {task.dueDate.toUpperCase()}
              </span>
            )}
          </div>
        ))}
      </RailCard>

      <RailAgenda />

      <RailCard>
        <div className="flex items-baseline">
          <span className="mlabel" style={{ color: 'var(--ac)' }}>
            {t('railWaitingHead')}
          </span>
          <button
            type="button"
            onClick={() => setView('waiting')}
            className="btn-bare ml-auto"
            style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}
          >
            {t('railWaitingArrow', { n: waiting.length })}
          </button>
        </div>
        {waiting.slice(0, 2).map((w, i) => (
          <div key={w.messageId} className="flex items-center gap-2" style={{ marginTop: 8 }}>
            <span className="min-w-0 flex-1 truncate" style={{ font: '400 12.5px var(--serif)' }}>
              {w.toAddrs[0] ?? '?'}{' '}
              <span style={{ font: '500 9px var(--mono)', color: 'var(--ac)' }}>
                {w.daysWaiting === 0 ? t('today') : `${w.daysWaiting}d`}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setView('waiting')
                setSelWaitingId(w.messageId)
              }}
              className="btn-bare flex-none"
              style={{
                font: '500 8.5px var(--mono)',
                padding: '2px 8px',
                ...(i === 0
                  ? { color: 'var(--paper)', background: 'var(--ink)' }
                  : { color: 'var(--muted)', border: '1px solid var(--hairline)' })
              }}
            >
              {t('nudgeBtn')}
            </button>
          </div>
        ))}
        <div style={{ font: '400 9px/1.5 var(--mono)', color: 'var(--faint)', marginTop: 9 }}>
          {t('railNudgeNote')}
        </div>
      </RailCard>

      <div className="mt-auto flex-none border-t border-hairline" style={{ padding: '9px 2px 0' }}>
        <div className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('yourStyle')}
        </div>
        <div
          style={{
            font: '400 11.5px/1.5 var(--serif)',
            fontStyle: 'italic',
            color: 'var(--secondary)',
            marginTop: 4
          }}
        >
          {t('railVoiceNote', { addr: voiceNote })}
        </div>
      </div>
    </div>
  )
}
