import { useId, useMemo, useState } from 'react'
import type { CalendarSummary } from '@shared/calendar-types'
import { useT } from '@renderer/lib/i18n'
import { parseTimeInput, systemTz } from './dates'
import { withAllDay, withStart, type EventForm } from './event-form'

// Gemeinsame Zeit-Felder von Editor und Schnell-Anlegen: 24-h-Zeitfeld (unabhängig
// von der Systemlocale), Datum, Ganztägig-Schalter, optionale Zeitzone.

/** 24-h-Textfeld; akzeptiert „9", „930", „9.30" und schreibt 'HH:mm' zurück. */
export function TimeField({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (v: string) => void
  label: string
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const [bad, setBad] = useState(false)
  const commit = (): void => {
    if (draft === null) return
    const parsed = parseTimeInput(draft)
    if (parsed) {
      setBad(false)
      onChange(parsed)
    } else setBad(true)
    setDraft(null)
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      className="paper-input cal-time-input"
      aria-label={label}
      aria-invalid={bad}
      placeholder="HH:mm"
      maxLength={5}
      value={draft ?? value}
      data-invalid={bad}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && draft !== null) {
          e.preventDefault()
          commit()
        }
      }}
    />
  )
}

export function DateField({
  value,
  onChange,
  label
}: {
  value: string
  onChange: (v: string) => void
  label: string
}): React.JSX.Element {
  return (
    <input
      type="date"
      className="paper-input cal-date-input"
      aria-label={label}
      value={value}
      onChange={(e) => {
        if (e.target.value) onChange(e.target.value)
      }}
    />
  )
}

/** Kalender-Auswahl (nur beschreibbare); bei bestehenden Terminen deaktiviert. */
export function CalendarSelect({
  calendars,
  value,
  onChange,
  disabled
}: {
  calendars: readonly CalendarSummary[]
  value: number | null
  onChange: (id: number) => void
  disabled: boolean
}): React.JSX.Element {
  const t = useT()
  return (
    <select
      className="paper-input"
      aria-label={t('cvCalendar')}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {calendars.map((c) => (
        <option key={c.id} value={c.id}>
          {c.displayName}
        </option>
      ))}
    </select>
  )
}

function timeZones(current: string | null): string[] {
  let list: string[] = []
  try {
    list = Intl.supportedValuesOf('timeZone')
  } catch {
    list = []
  }
  const set = new Set(['UTC', systemTz(), ...list])
  if (current) set.add(current)
  return [...set].sort()
}

export function EventTimeFields({
  form,
  onChange
}: {
  form: EventForm
  onChange: (f: EventForm) => void
}): React.JSX.Element {
  const t = useT()
  const id = useId()
  const sys = systemTz()
  const differs = !form.allDay && form.tzid !== sys
  const [showTz, setShowTz] = useState(false)
  const zones = useMemo(() => timeZones(form.tzid), [form.tzid])
  const tzVisible = !form.allDay && (differs || showTz)

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2" style={{ font: '400 11.5px var(--serif)' }}>
        <input
          type="checkbox"
          checked={form.allDay}
          onChange={(e) => onChange(withAllDay(form, e.target.checked))}
        />
        {t('cvAllDay')}
      </label>
      <div className="cal-time-row">
        <span className="mlabel cal-time-row__label">{t('cvFrom')}</span>
        <DateField
          value={form.startDate}
          label={t('cvFrom')}
          onChange={(d) => onChange(withStart(form, d, form.startTime))}
        />
        {!form.allDay && (
          <TimeField
            value={form.startTime}
            label={t('cvFromTime')}
            onChange={(v) => onChange(withStart(form, form.startDate, v))}
          />
        )}
      </div>
      <div className="cal-time-row">
        <span className="mlabel cal-time-row__label">{t('cvTo')}</span>
        <DateField
          value={form.endDate}
          label={t('cvTo')}
          onChange={(d) => onChange({ ...form, endDate: d })}
        />
        {!form.allDay && (
          <TimeField
            value={form.endTime}
            label={t('cvToTime')}
            onChange={(v) => onChange({ ...form, endTime: v })}
          />
        )}
      </div>
      {!form.allDay && !tzVisible && (
        <button
          type="button"
          className="text-btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => setShowTz(true)}
        >
          {t('cvTimezoneShow')}
        </button>
      )}
      {tzVisible && (
        <div className="cal-time-row">
          <label htmlFor={`${id}-tz`} className="mlabel cal-time-row__label">
            {t('cvTimezone')}
          </label>
          <select
            id={`${id}-tz`}
            className="paper-input"
            value={form.tzid ?? ''}
            onChange={(e) => onChange({ ...form, tzid: e.target.value || null })}
          >
            <option value="">{t('cvTimezoneFloating')}</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
