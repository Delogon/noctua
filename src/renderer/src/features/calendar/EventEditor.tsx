import { useState } from 'react'
import type {
  CalendarAttendee,
  CalendarEditScope,
  CalendarEventDetail,
  CalendarEventFields,
  CalendarSummary
} from '@shared/calendar-types'
import type { StringKey } from '@renderer/i18n/strings'
import { invoke } from '@renderer/lib/ipc'
import { useI18n, useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { instanceKey, useCalendar } from '@renderer/stores/calendar'
import { useCalendarEventActions, useCalendarEventDetail } from '@renderer/queries/calendar'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import { ALARM_PRESETS, type AlarmChoice } from './alarms'
import { addDays, parseDayKey } from './dates'
import {
  fieldsFromForm,
  formFromFields,
  validateForm,
  withFreq,
  type EventForm
} from './event-form'
import { MAX_INTERVAL, WEEKDAYS, type RecurrenceFreq, type Weekday } from './rrule'
import { diffFields, effectiveScope, needsScope, patchForScope } from './scope'
import { ScopeChoice } from './ScopeChoice'
import { CalendarSelect, DateField, EventTimeFields } from './TimeFields'
import { weekdayShort } from './format'

// Termin-Editor als Seitenblatt neben dem Raster (gleiche sheet-card-Sprache wie
// Aufgaben/Wartet). Neue Termine füllen das Formular direkt, bestehende laden erst die
// Details. Schreibgeschützte Kalender: alle Felder gesperrt, keine Speichern/Löschen-
// Knöpfe. Die Kalenderwahl ist bei bestehenden Terminen fest (Backend kann nicht verschieben).

const ALARM_KEYS: Record<(typeof ALARM_PRESETS)[number]['id'], StringKey> = {
  none: 'cvAlarmNone',
  '0': 'cvAlarmAtStart',
  '5': 'cvAlarm5',
  '10': 'cvAlarm10',
  '15': 'cvAlarm15',
  '30': 'cvAlarm30',
  '60': 'cvAlarm60',
  '1440': 'cvAlarm1440'
}
const FREQ_KEYS: Record<RecurrenceFreq, StringKey> = {
  NONE: 'cvRecNone',
  DAILY: 'cvRecDaily',
  WEEKLY: 'cvRecWeekly',
  MONTHLY: 'cvRecMonthly',
  YEARLY: 'cvRecYearly'
}
const UNIT_KEYS: Record<Exclude<RecurrenceFreq, 'NONE'>, StringKey> = {
  DAILY: 'cvUnitDay',
  WEEKLY: 'cvUnitWeek',
  MONTHLY: 'cvUnitMonth',
  YEARLY: 'cvUnitYear'
}
const PARTSTAT_KEYS: Record<string, StringKey> = {
  ACCEPTED: 'cvPartAccepted',
  DECLINED: 'cvPartDeclined',
  TENTATIVE: 'cvPartTentative',
  'NEEDS-ACTION': 'cvPartNeeds',
  DELEGATED: 'cvPartDelegated'
}

function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div style={{ marginTop: 14 }}>
      <div className="mlabel" style={{ color: 'var(--muted)', marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Attendees({
  attendees,
  organizer
}: {
  attendees: readonly CalendarAttendee[]
  organizer: { email: string; name: string | null } | null
}): React.JSX.Element | null {
  const t = useT()
  if (attendees.length === 0 && !organizer) return null
  return (
    <Field label={t('cvAttendees')}>
      <div className="tint-card" style={{ padding: '8px 10px' }}>
        {organizer && (
          <div className="flex items-baseline gap-2" style={{ font: '400 12px var(--serif)' }}>
            <span className="min-w-0 flex-1 truncate">{organizer.name || organizer.email}</span>
            <span className="mchip" style={{ border: '1px solid var(--hairline)' }}>
              {t('cvOrganizer')}
            </span>
          </div>
        )}
        {attendees.map((a) => {
          const key = PARTSTAT_KEYS[a.partstat.toUpperCase()]
          return (
            <div
              key={a.email}
              className="flex items-baseline gap-2"
              style={{ font: '400 12px var(--serif)', marginTop: 4 }}
            >
              <span className="min-w-0 flex-1 truncate" title={a.email}>
                {a.name || a.email}
              </span>
              <span className="mchip" style={{ color: 'var(--muted)' }}>
                {key ? t(key) : a.partstat.toLowerCase()}
              </span>
            </div>
          )
        })}
      </div>
      <div className="mmeta" style={{ marginTop: 5, color: 'var(--faint)' }}>
        {t('cvAttendeesNote')}
      </div>
    </Field>
  )
}

function RecurrenceEditor({
  form,
  onChange,
  customText
}: {
  form: EventForm
  onChange: (f: EventForm) => void
  customText: string | null
}): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  if (customText !== null) {
    return (
      <div className="tint-card" style={{ padding: '8px 10px' }}>
        <div className="mmeta">{t('cvRecCustom')}</div>
        <div style={{ font: '400 11px var(--mono)', marginTop: 4, wordBreak: 'break-all' }}>
          {customText}
        </div>
        <button
          type="button"
          className="text-btn"
          style={{ marginTop: 4 }}
          onClick={() => onChange({ ...form, recCustom: null })}
        >
          {t('cvRecReplace')}
        </button>
      </div>
    )
  }
  const rec = form.rec
  return (
    <div className="flex flex-col gap-2">
      <select
        className="paper-input"
        aria-label={t('cvRepeat')}
        value={rec.freq}
        onChange={(e) => onChange(withFreq(form, e.target.value as RecurrenceFreq))}
      >
        {(Object.keys(FREQ_KEYS) as RecurrenceFreq[]).map((f) => (
          <option key={f} value={f}>
            {t(FREQ_KEYS[f])}
          </option>
        ))}
      </select>
      {rec.freq !== 'NONE' && (
        <>
          <div className="flex items-center gap-2" style={{ font: '400 11.5px var(--serif)' }}>
            <span>{t('cvEvery')}</span>
            <input
              type="number"
              min={1}
              max={MAX_INTERVAL}
              className="paper-input"
              style={{ width: 64 }}
              aria-label={t('cvEvery')}
              value={rec.interval}
              onChange={(e) =>
                onChange({
                  ...form,
                  rec: {
                    ...rec,
                    interval: Math.max(1, Math.min(MAX_INTERVAL, +e.target.value || 1))
                  }
                })
              }
            />
            <span>{t(UNIT_KEYS[rec.freq])}</span>
          </div>
          {rec.freq === 'WEEKLY' && (
            <div className="flex gap-1" role="group" aria-label={t('cvOnDays')}>
              {WEEKDAYS.map((d: Weekday, i) => {
                const on = rec.byday.includes(d)
                return (
                  <button
                    key={d}
                    type="button"
                    className="cal-daytoggle"
                    aria-pressed={on}
                    data-on={on}
                    onClick={() => {
                      const byday = on ? rec.byday.filter((x) => x !== d) : [...rec.byday, d]
                      // mindestens ein Tag bleibt gewählt
                      if (byday.length > 0) onChange({ ...form, rec: { ...rec, byday } })
                    }}
                  >
                    {weekdayShort(lang, new Date(2024, 0, 1 + i)).slice(0, 2)}
                  </button>
                )
              })}
            </div>
          )}
          <div className="flex items-center gap-2">
            <select
              className="paper-input"
              style={{ width: 'auto' }}
              aria-label={t('cvRecEnds')}
              value={rec.end.kind}
              onChange={(e) => {
                const kind = e.target.value
                if (kind === 'never') onChange({ ...form, rec: { ...rec, end: { kind: 'never' } } })
                else if (kind === 'count')
                  onChange({ ...form, rec: { ...rec, end: { kind: 'count', count: 10 } } })
                else {
                  const start = parseDayKey(form.startDate)
                  const until = addDays(start, 30)
                  const key = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`
                  onChange({ ...form, rec: { ...rec, end: { kind: 'until', date: key } } })
                }
              }}
            >
              <option value="never">{t('cvEndNever')}</option>
              <option value="until">{t('cvEndUntil')}</option>
              <option value="count">{t('cvEndCount')}</option>
            </select>
            {rec.end.kind === 'until' && (
              <DateField
                value={rec.end.date}
                label={t('cvEndUntil')}
                onChange={(date) =>
                  onChange({ ...form, rec: { ...rec, end: { kind: 'until', date } } })
                }
              />
            )}
            {rec.end.kind === 'count' && (
              <input
                type="number"
                min={1}
                max={MAX_INTERVAL}
                className="paper-input"
                style={{ width: 72 }}
                aria-label={t('cvEndCount')}
                value={rec.end.count}
                onChange={(e) =>
                  onChange({
                    ...form,
                    rec: {
                      ...rec,
                      end: {
                        kind: 'count',
                        count: Math.max(1, Math.min(MAX_INTERVAL, +e.target.value || 1))
                      }
                    }
                  })
                }
              />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function EditorForm({
  detail,
  recurrenceId,
  initialForm,
  calendars
}: {
  detail: CalendarEventDetail | null
  /** Vorkommen, über das der Editor geöffnet wurde (für Bereich 'dieser Termin') */
  recurrenceId: string | null
  initialForm: EventForm
  calendars: readonly CalendarSummary[]
}): React.JSX.Element {
  const t = useT()
  const closeEditor = useCalendar((s) => s.closeEditor)
  const actions = useCalendarEventActions()
  const [form, setForm] = useState(initialForm)
  // Basis für den Diff: der Stand beim Öffnen (spätere Sync-Aktualisierungen ändern ihn nicht)
  const [baseline] = useState(() => detail?.fields ?? null)
  const [prompt, setPrompt] = useState<'save' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)

  const readOnly = detail?.readOnly ?? false
  const recurring = detail?.recurring ?? false
  const error = validateForm(form)
  const writable = calendars.filter((c) => !c.readOnly && c.components.includes('VEVENT'))
  // Bestehender Termin: sein Kalender steht fest, auch wenn er nicht (mehr) in der Auswahl wäre
  const selectable = detail ? calendars.filter((c) => c.id === detail.calendarId) : writable
  const canSave = !readOnly && !busy && error === null && form.calendarId !== null

  const fail = (err: unknown): void => {
    toast.error(
      t('cvSaveFailed', { err: cleanIpcError(err instanceof Error ? err.message : String(err)) })
    )
    setBusy(false)
  }

  const runSave = async (scope: CalendarEditScope | null): Promise<void> => {
    if (!canSave || form.calendarId === null) return
    setBusy(true)
    try {
      if (!detail || !baseline) {
        await actions.create({ ...fieldsFromForm(form, null), calendarId: form.calendarId })
      } else {
        const next = fieldsFromForm(form, baseline)
        const patch = diffFields(baseline, next)
        if (Object.keys(patch).length > 0) {
          const target = { recurring }
          const chosen = effectiveScope(target, scope)
          // Ganze Serie + Zeitänderung an einem Vorkommen: Serienstart mitführen
          let masterTime: CalendarEventFields['time'] | null = null
          if (recurring && chosen === 'all' && patch.time) {
            const master = await invoke('calendar:events:get', {
              objectId: detail.objectId,
              recurrenceId: null
            })
            masterTime = master.event.fields.time
          }
          await actions.update({
            objectId: detail.objectId,
            scope: chosen,
            recurrenceId: recurrenceId ?? detail.recurrenceId,
            patch: patchForScope(chosen, patch, {
              recurring,
              occurrenceTime: baseline.time,
              masterTime
            })
          })
        }
      }
      closeEditor()
    } catch (err) {
      fail(err)
    }
  }

  const runDelete = async (scope: CalendarEditScope | null): Promise<void> => {
    if (!detail || readOnly || busy) return
    setBusy(true)
    try {
      await actions.remove({
        objectId: detail.objectId,
        scope: effectiveScope({ recurring }, scope),
        recurrenceId: recurrenceId ?? detail.recurrenceId
      })
      closeEditor()
    } catch (err) {
      fail(err)
    }
  }

  const onSaveClick = (): void => {
    if (!canSave) return
    if (detail && needsScope({ recurring })) {
      // Ohne Änderung kein Dialog
      const changed =
        baseline && Object.keys(diffFields(baseline, fieldsFromForm(form, baseline))).length > 0
      if (!changed) closeEditor()
      else setPrompt('save')
    } else void runSave(null)
  }

  return (
    <div
      className="sheet-card cal-editor flex min-h-0 flex-none flex-col"
      data-cal-modal
      role="complementary"
      aria-label={t(detail ? 'cvEditorEdit' : 'cvEditorNew')}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
          e.preventDefault()
          onSaveClick()
        }
      }}
    >
      <div
        className="flex flex-none items-baseline gap-2 border-b border-hairline"
        style={{ padding: '12px 18px 9px' }}
      >
        <span className="mlabel" style={{ letterSpacing: 1.5, color: 'var(--ac)' }}>
          {t(detail ? 'cvEditorEdit' : 'cvEditorNew')}
        </span>
        {readOnly && (
          <span
            className="mchip"
            style={{ border: '1px solid var(--hairline)', color: 'var(--muted)' }}
          >
            {t('calReadOnly')}
          </span>
        )}
        {detail?.pending && (
          <span className="mchip" style={{ color: 'var(--paper)', background: 'var(--ac)' }}>
            {t('cvPending')}
          </span>
        )}
        <button
          type="button"
          className="btn-bare hit-target ml-auto"
          aria-label={t('cvClose')}
          title={t('cvClose')}
          style={{ font: '500 13px var(--mono)', color: 'var(--muted)' }}
          onClick={closeEditor}
        >
          ×
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: '4px 18px 14px' }}>
        <fieldset disabled={readOnly || busy} className="cal-fieldset">
          <input
            autoFocus={!detail}
            type="text"
            className="cal-summary-input"
            placeholder={t('cvTitlePh')}
            aria-label={t('cvTitle')}
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
          />

          <Field label={t('cvCalendar')}>
            <CalendarSelect
              calendars={selectable}
              value={form.calendarId}
              onChange={(cid) => setForm({ ...form, calendarId: cid })}
              disabled={!!detail}
            />
            {detail && (
              <div className="mmeta" style={{ marginTop: 4, color: 'var(--faint)' }}>
                {t('cvCalendarFixed')}
              </div>
            )}
          </Field>

          <Field label={t('cvWhen')}>
            <EventTimeFields form={form} onChange={setForm} />
          </Field>

          <Field label={t('cvRepeat')}>
            <RecurrenceEditor form={form} onChange={setForm} customText={form.recCustom} />
          </Field>

          <Field label={t('cvAlarm')}>
            <select
              className="paper-input"
              aria-label={t('cvAlarm')}
              value={form.alarm}
              onChange={(e) => setForm({ ...form, alarm: e.target.value as AlarmChoice })}
            >
              {ALARM_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {t(ALARM_KEYS[p.id])}
                </option>
              ))}
              {form.alarm === 'custom' && (
                <option value="custom">
                  {t('cvAlarmCustom', { n: baseline?.alarms.length ?? 0 })}
                </option>
              )}
            </select>
          </Field>

          <Field label={t('cvShowAs')}>
            <select
              className="paper-input"
              aria-label={t('cvShowAs')}
              value={form.transparency}
              onChange={(e) =>
                setForm({ ...form, transparency: e.target.value as EventForm['transparency'] })
              }
            >
              <option value="OPAQUE">{t('cvBusy')}</option>
              <option value="TRANSPARENT">{t('cvFree')}</option>
            </select>
          </Field>

          <Field label={t('cvLocation')}>
            <input
              type="text"
              className="paper-input"
              aria-label={t('cvLocation')}
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
            />
          </Field>

          <Field label={t('cvDescription')}>
            <textarea
              className="paper-input"
              style={{ minHeight: 84, resize: 'vertical', font: '400 12.5px/1.5 var(--serif)' }}
              aria-label={t('cvDescription')}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </fieldset>

        {baseline && <Attendees attendees={baseline.attendees} organizer={baseline.organizer} />}
      </div>

      <div className="flex-none border-t border-hairline" style={{ padding: '10px 18px 12px' }}>
        {error && (
          <div style={{ font: '400 10px var(--mono)', color: 'var(--ac)', marginBottom: 8 }}>
            {error === 'endBeforeStart'
              ? t('cvErrEnd')
              : error === 'invalidUntil'
                ? t('cvErrUntil')
                : t('cvErrTime')}
          </div>
        )}
        {prompt === 'save' && (
          <ScopeChoice
            kind="edit"
            busy={busy}
            onChoose={(scope) => void runSave(scope)}
            onCancel={() => setPrompt(null)}
          />
        )}
        {prompt === 'delete' && recurring && (
          <ScopeChoice
            kind="delete"
            busy={busy}
            onChoose={(scope) => void runDelete(scope)}
            onCancel={() => setPrompt(null)}
          />
        )}
        {prompt === 'delete' && !recurring && (
          <div className="flex items-center gap-3">
            <span style={{ font: '400 12px var(--serif)', fontStyle: 'italic' }}>
              {t('cvDeleteConfirm')}
            </span>
            <button
              type="button"
              className="ink-btn"
              style={{ background: 'var(--ac)', borderColor: 'var(--ac)' }}
              disabled={busy}
              onClick={() => void runDelete(null)}
            >
              {t('cvDelete')}
            </button>
            <button type="button" className="text-btn" onClick={() => setPrompt(null)}>
              {t('cancel')}
            </button>
          </div>
        )}
        {prompt === null && (
          <div className="flex items-center gap-3">
            {!readOnly && (
              <button type="button" className="ink-btn" disabled={!canSave} onClick={onSaveClick}>
                {t('cvSave')}
                <span style={{ opacity: 0.6 }}>⌘↵</span>
              </button>
            )}
            <button type="button" className="text-btn" onClick={closeEditor}>
              {readOnly ? t('cvClose') : t('cancel')}
            </button>
            {detail && !readOnly && (
              <button
                type="button"
                className="text-btn"
                style={{ marginLeft: 'auto', color: 'var(--ac)' }}
                disabled={busy}
                onClick={() => setPrompt('delete')}
              >
                {t('cvDelete')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Skeleton({ text, onClose }: { text: string; onClose: () => void }): React.JSX.Element {
  const t = useT()
  return (
    <div className="sheet-card cal-editor flex flex-none flex-col" data-cal-modal>
      <div
        className="flex items-baseline border-b border-hairline"
        style={{ padding: '12px 18px 9px' }}
      >
        <span className="mlabel" style={{ color: 'var(--ac)' }}>
          {t('cvEditorEdit')}
        </span>
        <button
          type="button"
          className="btn-bare hit-target ml-auto"
          aria-label={t('cvClose')}
          style={{ font: '500 13px var(--mono)', color: 'var(--muted)' }}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="mmeta" style={{ padding: 18 }}>
        {text}
      </div>
    </div>
  )
}

function ExistingEditor({
  objectId,
  recurrenceId,
  calendars
}: {
  objectId: number
  recurrenceId: string | null
  calendars: readonly CalendarSummary[]
}): React.JSX.Element {
  const t = useT()
  const closeEditor = useCalendar((s) => s.closeEditor)
  const q = useCalendarEventDetail(objectId, recurrenceId)
  if (q.isError) return <Skeleton text={t('cvLoadFailed')} onClose={closeEditor} />
  if (!q.data) return <Skeleton text={t('cvLoading')} onClose={closeEditor} />
  return (
    <EditorForm
      key={instanceKey(objectId, recurrenceId)}
      detail={q.data}
      recurrenceId={recurrenceId}
      initialForm={formFromFields(q.data.fields, q.data.calendarId)}
      calendars={calendars}
    />
  )
}

/** Wurzel: wählt je nach Ziel Neu-/Bearbeiten-Formular. */
export function EventEditor({
  calendars
}: {
  calendars: readonly CalendarSummary[]
}): React.JSX.Element | null {
  const editor = useCalendar((s) => s.editor)
  if (!editor) return null
  if (editor.kind === 'new') {
    return (
      <EditorForm
        key={`new-${editor.rev}`}
        detail={null}
        recurrenceId={null}
        initialForm={editor.form}
        calendars={calendars}
      />
    )
  }
  return (
    <ExistingEditor
      key={instanceKey(editor.objectId, editor.recurrenceId)}
      objectId={editor.objectId}
      recurrenceId={editor.recurrenceId}
      calendars={calendars}
    />
  )
}
