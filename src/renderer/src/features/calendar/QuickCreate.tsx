import { useMemo, useState } from 'react'
import type { CalendarSummary } from '@shared/calendar-types'
import { useT } from '@renderer/lib/i18n'
import { computePopoverPlacement } from '@renderer/lib/popover-placement'
import { toast } from '@renderer/stores/toast'
import { useCalendar, type QuickDraft } from '@renderer/stores/calendar'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import { useCalendarEventActions } from '@renderer/queries/calendar'
import { fieldsFromForm, formFromSlot, validateForm } from './event-form'
import { CalendarSelect, EventTimeFields } from './TimeFields'

// Schnell-Anlegen: kleines Popover am Slot (Titel, Zeit, Kalender). „Mehr …" öffnet
// den vollen Editor mit dem bisherigen Entwurf.

const WIDTH = 320
const HEIGHT = 300

export function QuickCreate({
  draft,
  calendars,
  defaultCalendarId
}: {
  draft: QuickDraft
  calendars: readonly CalendarSummary[]
  defaultCalendarId: number | null
}): React.JSX.Element {
  const t = useT()
  const { setQuick, openNew } = useCalendar()
  const actions = useCalendarEventActions()
  const [form, setForm] = useState(() =>
    formFromSlot(draft.startMs, draft.endMs, draft.allDay, defaultCalendarId)
  )
  const [busy, setBusy] = useState(false)
  const pos = useMemo(
    () =>
      computePopoverPlacement(
        draft.rect,
        { width: WIDTH, height: HEIGHT },
        { width: window.innerWidth, height: window.innerHeight },
        { gap: 6 }
      ),
    [draft.rect]
  )
  // Seitlich neben den Slot statt darunter, wenn dort Platz ist (Slot bleibt sichtbar)
  const left =
    draft.rect.left + draft.rect.width + 8 + WIDTH <= window.innerWidth - 8
      ? draft.rect.left + draft.rect.width + 8
      : draft.rect.left - WIDTH - 8 >= 8
        ? draft.rect.left - WIDTH - 8
        : pos.left
  const sideways = left !== pos.left
  const top = sideways
    ? Math.max(8, Math.min(draft.rect.top, window.innerHeight - HEIGHT - 8))
    : pos.top

  const error = validateForm(form)
  const canSave = !busy && error === null && form.calendarId !== null

  const save = (): void => {
    if (!canSave || form.calendarId === null) return
    setBusy(true)
    void actions
      .create({ ...fieldsFromForm(form, null), calendarId: form.calendarId })
      .then(() => setQuick(null))
      .catch((err: unknown) => {
        toast.error(t('cvSaveFailed', { err: cleanIpcError(String(err)) }))
        setBusy(false)
      })
  }

  return (
    <div
      className="overlay-card cal-quick"
      data-cal-modal
      role="dialog"
      aria-label={t('cvQuickTitle')}
      style={{ left, top, width: WIDTH }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
          e.preventDefault()
          save()
        }
      }}
    >
      <div className="mlabel" style={{ color: 'var(--ac)', marginBottom: 8 }}>
        {t('cvQuickTitle')}
      </div>
      <input
        autoFocus
        type="text"
        className="paper-input"
        style={{ font: '500 14px var(--serif)' }}
        placeholder={t('cvTitlePh')}
        aria-label={t('cvTitle')}
        value={form.summary}
        onChange={(e) => setForm({ ...form, summary: e.target.value })}
      />
      <div style={{ marginTop: 10 }}>
        <EventTimeFields form={form} onChange={setForm} />
      </div>
      <div style={{ marginTop: 10 }}>
        <CalendarSelect
          calendars={calendars}
          value={form.calendarId}
          onChange={(id) => setForm({ ...form, calendarId: id })}
          disabled={false}
        />
      </div>
      {error && (
        <div style={{ font: '400 10px var(--mono)', color: 'var(--ac)', marginTop: 8 }}>
          {error === 'endBeforeStart'
            ? t('cvErrEnd')
            : error === 'invalidUntil'
              ? t('cvErrUntil')
              : t('cvErrTime')}
        </div>
      )}
      <div className="flex items-center gap-3" style={{ marginTop: 12 }}>
        <button type="button" className="ink-btn" disabled={!canSave} onClick={save}>
          {t('cvSave')}
        </button>
        <button type="button" className="text-btn" onClick={() => openNew(form)}>
          {t('cvMoreOptions')}
        </button>
        <button
          type="button"
          className="text-btn"
          style={{ marginLeft: 'auto' }}
          onClick={() => setQuick(null)}
        >
          {t('cancel')}
        </button>
      </div>
    </div>
  )
}
