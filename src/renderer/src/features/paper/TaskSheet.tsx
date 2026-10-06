import { useCallback, useEffect, useMemo, useRef } from 'react'
import { invoke } from '@renderer/lib/ipc'
import { useTasks } from '@renderer/queries/tasks'
import { usePaper } from '@renderer/stores/paper'
import { SheetEmpty } from '@renderer/components/paper/SheetEmpty'
import { useT } from '@renderer/lib/i18n'
import { useThread } from '@renderer/queries/threads'
import { OriginalMailBody } from '@renderer/components/OriginalMailBody'
import { TaskSyncGlyph } from './TaskSyncGlyph'
import { taskIdAfterCompletion, visibleTaskRows } from './task-navigation'

export function TaskSheet(): React.JSX.Element {
  const t = useT()
  const openTasks = useTasks('open')
  const doneTasks = useTasks('done')
  const {
    selTaskId,
    setSelTaskId,
    showOpenTasks,
    showCompletedTasks,
    setView,
    setSelThreadKey,
    toastNow
  } = usePaper()
  const taskMutationPending = useRef(false)
  const all = useMemo(
    () =>
      visibleTaskRows(openTasks.data?.tasks ?? [], doneTasks.data?.tasks ?? [], {
        open: showOpenTasks,
        done: showCompletedTasks
      }),
    [openTasks.data, doneTasks.data, showOpenTasks, showCompletedTasks]
  )
  const sel = all.find((x) => x.id === selTaskId) ?? all[0]
  const thread = useThread(sel?.threadKey ?? null)
  const sourceMessage = thread.data?.find((message) => message.id === sel?.sourceMessageId)

  const toggle = useCallback(
    (advanceAfterCompletion = false): void => {
      if (!sel || taskMutationPending.current) return

      const completing = sel.status !== 'done'
      // Verschwindet die Aufgabe durch den Wechsel aus der gefilterten Sicht?
      const willDisappear = completing ? !showCompletedTasks : !showOpenTasks
      const shouldAdvance = (completing && advanceAfterCompletion) || willDisappear
      const nextTaskId = shouldAdvance
        ? taskIdAfterCompletion(completing ? (openTasks.data?.tasks ?? []) : all, sel.id)
        : null
      const selectionAtStart = usePaper.getState().selTaskId
      taskMutationPending.current = true

      void invoke('tasks:update', {
        id: sel.id,
        status: completing ? 'done' : 'open'
      })
        .then(() => {
          if (
            shouldAdvance &&
            usePaper.getState().selTaskId === selectionAtStart &&
            (nextTaskId !== null || willDisappear)
          ) {
            setSelTaskId(nextTaskId)
          }
        })
        .catch(() => toastNow(t('toastTaskUpdateFailed')))
        .finally(() => {
          taskMutationPending.current = false
        })
    },
    [openTasks.data?.tasks, all, sel, setSelTaskId, showOpenTasks, showCompletedTasks, t, toastNow]
  )

  const openSource = useCallback((): void => {
    if (!sel?.threadKey) return
    setView('inbox')
    setSelThreadKey(sel.threadKey)
  }, [sel, setView, setSelThreadKey])

  useEffect(() => {
    const onAction = (e: Event): void => {
      const action = (e as CustomEvent<string>).detail
      if (action === 'toggle') toggle(true)
      else if (action === 'openSource') {
        if (sel?.threadKey) openSource()
        else toastNow(t('threadFiled'))
      }
    }
    window.addEventListener('paper:task', onAction)
    return () => window.removeEventListener('paper:task', onAction)
  }, [toggle, openSource, sel, toastNow, t])

  if (!sel) return <SheetEmpty line={t('tasksEmpty')} sub={t('tasksEmptySub')} />

  const [srcFrom, srcRest] = (sel.sourceSubject ?? '').split(' — ')

  return (
    <div className="sheet-card min-w-0 flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div className="mmeta" style={{ letterSpacing: '1.5px' }}>
        {t('task')}
      </div>
      <div
        style={{
          font: '500 21px var(--serif)',
          marginTop: 6,
          ...(sel.status === 'done'
            ? { textDecoration: 'line-through', color: 'var(--faint)' }
            : {})
        }}
      >
        {sel.title}
      </div>
      <div className="flex items-center gap-2.5" style={{ marginTop: 10 }}>
        {sel.dueDate && (
          <span
            className="mchip"
            style={{ color: 'var(--paper)', background: 'var(--ac)', padding: '1px 6px' }}
          >
            {sel.dueDate.toUpperCase()}
          </span>
        )}
        <span className="mmeta">{t('extractedAuto')}</span>
        <TaskSyncGlyph state={sel.syncState} />
      </div>
      <div className="double-rule" style={{ marginTop: 18 }} />
      {sel.sourceSubject && (
        <>
          <div className="mmeta" style={{ marginTop: 14, letterSpacing: '1.5px' }}>
            {t('source')}
          </div>
          <div className="tint-card" style={{ padding: '12px 14px', marginTop: 8 }}>
            <div className="flex items-baseline gap-2">
              <span style={{ font: '600 13.5px var(--serif)' }}>
                {srcFrom || sel.sourceSubject}
              </span>
            </div>
            {srcRest && (
              <div
                style={{
                  font: '400 12.5px var(--serif)',
                  fontStyle: 'italic',
                  color: 'var(--secondary)',
                  marginTop: 3
                }}
              >
                ↳ {srcRest}
              </div>
            )}
            <div
              style={{
                borderTop: '1px solid var(--hairline-light)',
                marginTop: 10,
                paddingTop: 10
              }}
            >
              <OriginalMailBody message={sourceMessage} loading={thread.isLoading} />
            </div>
          </div>
        </>
      )}
      <div
        className="flex items-center gap-3.5"
        style={{ marginTop: 16, font: '400 9.5px var(--mono)', color: 'var(--muted)' }}
      >
        <button type="button" onClick={() => toggle()} className="ink-btn">
          {t('spaceKey')} — {sel.status === 'done' ? t('spaceReopen') : t('spaceDone')}
        </button>
        {sel.threadKey && (
          <button type="button" onClick={openSource} className="text-btn">
            {t('openThread')}
          </button>
        )}
      </div>
    </div>
  )
}
