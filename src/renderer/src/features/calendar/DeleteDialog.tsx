import { useState } from 'react'
import type { CalendarEditScope } from '@shared/calendar-types'
import { useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { useCalendar, type DeleteTarget } from '@renderer/stores/calendar'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import {
  useCalendarEventActions,
  useCalendarEventDetail,
  useSchedulingInfo
} from '@renderer/queries/calendar'
import { effectiveScope } from './scope'
import { ScopeChoice } from './ScopeChoice'

// Löschen per Taste (Backspace/Entf) mit Bestätigung; Serien fragen nach dem Bereich.

export function DeleteDialog({ target }: { target: DeleteTarget }): React.JSX.Element {
  const t = useT()
  const setDeleteTarget = useCalendar((s) => s.setDeleteTarget)
  const closeEditor = useCalendar((s) => s.closeEditor)
  const actions = useCalendarEventActions()
  const [busy, setBusy] = useState(false)
  const [notify, setNotify] = useState(true)
  // Mit Teilnehmern (und wir organisieren, der Server versendet nicht selbst): Rückfrage „benachrichtigen?"
  const detail = useCalendarEventDetail(target.objectId, target.recurrenceId).data
  const info = useSchedulingInfo(detail?.calendarId ?? null, target.objectId).data
  const attendeeCount = detail?.fields.attendees.length ?? 0
  const askNotify = !!info && info.organizerIsMe && !info.autoSchedule && attendeeCount > 0

  const run = (scope: CalendarEditScope | null): void => {
    setBusy(true)
    void actions
      .remove({
        objectId: target.objectId,
        scope: effectiveScope(target, scope),
        recurrenceId: target.recurrenceId,
        notifyAttendees: askNotify ? notify : undefined
      })
      .then(() => {
        // War der gelöschte Termin im Editor offen, schließt dieser mit
        const editor = useCalendar.getState().editor
        if (editor?.kind === 'existing' && editor.objectId === target.objectId) closeEditor()
        setDeleteTarget(null)
      })
      .catch((err: unknown) => {
        toast.error(t('cvDeleteFailed', { err: cleanIpcError(String(err)) }))
        setBusy(false)
      })
  }

  return (
    <div className="scrim" style={{ zIndex: 40 }} role="presentation">
      <div
        className="overlay-card cal-dialog"
        data-cal-modal
        role="alertdialog"
        aria-label={t('cvDeleteTitle')}
      >
        <div className="mlabel" style={{ color: 'var(--muted)' }}>
          {t('cvDeleteTitle')}
        </div>
        <div style={{ font: '500 17px var(--serif)', margin: '6px 0 14px' }}>
          {target.summary || t('cvNoTitle')}
        </div>
        {askNotify && (
          <div style={{ margin: '-6px 0 12px' }}>
            <div className="mmeta" style={{ marginBottom: 4 }}>
              {t('cvDeleteHasAttendees', { n: attendeeCount })}
            </div>
            <label className="flex items-start gap-2" style={{ font: '400 12px var(--serif)' }}>
              <input
                type="checkbox"
                checked={notify}
                disabled={busy}
                style={{ marginTop: 3 }}
                onChange={(e) => setNotify(e.target.checked)}
              />
              <span>{t('cvNotifyDelete')}</span>
            </label>
          </div>
        )}
        {target.recurring ? (
          <ScopeChoice
            kind="delete"
            busy={busy}
            onChoose={run}
            onCancel={() => setDeleteTarget(null)}
          />
        ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="ink-btn"
              style={{ background: 'var(--ac)', borderColor: 'var(--ac)' }}
              disabled={busy}
              autoFocus
              onClick={() => run(null)}
            >
              {t('cvDelete')}
            </button>
            <button type="button" className="text-btn" onClick={() => setDeleteTarget(null)}>
              {t('cancel')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
