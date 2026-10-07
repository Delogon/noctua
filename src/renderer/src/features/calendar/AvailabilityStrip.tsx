import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { CalendarAttendee } from '@shared/calendar-types'
import type { BusyIntervalDto, FreeBusyResult } from '@shared/invitation-types'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { addDays, parseDayKey, wallAsUtcMs } from './dates'
import { normEmail } from './attendees'
import {
  findCommonFreeSlot,
  localDayAt,
  stripSegments,
  wallToLocalMs,
  type Interval
} from './free-slots'
import type { EventForm } from './event-form'

// Verfügbarkeitsstreifen (08–20) für den Tag des Termins: je Teilnehmer eine Zeile aus
// calendar:freebusy (Server mit Scheduling-Outbox) bzw. calendar:freebusy:self (ich).
// Dazu „Nächster gemeinsamer freier Termin": verschiebt den Termin auf das erste Fenster
// gleicher Dauer, in dem alle mit Auskunft frei sind (nächste 10 Arbeitstage, 08–18).

const STRIP_FROM = 8
const STRIP_TO = 20
const LOOKAHEAD_DAYS = 21
const MAX_QUERY = 50

interface Person {
  email: string
  label: string
  /** Eigene Zeile: Belegung kommt aus den lokalen Kalendern */
  me: boolean
}

interface Loaded {
  me: BusyIntervalDto[]
  others: FreeBusyResult[]
}

async function loadBusy(
  accountId: number,
  emails: string[],
  rangeStart: number,
  rangeEnd: number,
  excludeObjectId: number | null
): Promise<Loaded> {
  const [self, fb] = await Promise.all([
    invoke('calendar:freebusy:self', {
      rangeStart,
      rangeEnd,
      excludeObjectId: excludeObjectId ?? undefined
    }),
    emails.length > 0
      ? invoke('calendar:freebusy', {
          accountId,
          attendees: emails.slice(0, MAX_QUERY),
          rangeStart,
          rangeEnd
        })
      : Promise.resolve({ results: [] as FreeBusyResult[] })
  ])
  return { me: self.busy, others: fb.results }
}

/** Erster Zeitpunkt der Dauer, an dem alle mit Auskunft frei sind (ab jetzt, nächste 10 Arbeitstage). */
async function nextCommonSlot(args: {
  accountId: number
  emails: string[]
  durationMs: number
  excludeObjectId: number | null
}): Promise<{ slot: Interval | null; unknown: number }> {
  const from = Date.now()
  const rangeStart = localDayAt(from, 0)
  const rangeEnd = addDays(new Date(rangeStart), LOOKAHEAD_DAYS).getTime()
  const data = await loadBusy(
    args.accountId,
    args.emails,
    rangeStart,
    rangeEnd,
    args.excludeObjectId
  )
  const lists: Interval[][] = [data.me]
  let unknown = 0
  for (const e of args.emails) {
    const r = data.others.find((x) => x.email === e)
    if (r && r.source !== 'unavailable') lists.push(r.busy)
    else unknown++
  }
  return {
    slot: findCommonFreeSlot({ busy: lists, durationMs: args.durationMs, fromMs: from }),
    unknown
  }
}

export function AvailabilityStrip({
  form,
  attendees,
  mine,
  accountId,
  excludeObjectId,
  onMove
}: {
  form: EventForm
  /** Teilnehmer (eigene Adressen werden als „ich"-Zeile geführt) */
  attendees: readonly CalendarAttendee[]
  mine: ReadonlySet<string>
  accountId: number
  /** Der bearbeitete Termin zählt in „meiner" Belegung nicht mit */
  excludeObjectId: number | null
  /** Neuer Beginn (lokal, ms); die Dauer behält der Editor */
  onMove: (startMs: number) => void
}): React.JSX.Element | null {
  const t = useT()
  const [finding, setFinding] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const people: Person[] = [{ email: '', label: t('cvYou'), me: true }]
  for (const a of attendees) {
    const e = normEmail(a.email)
    if (!mine.has(e)) people.push({ email: e, label: a.name || a.email, me: false })
  }
  const emails = people.filter((p) => !p.me).map((p) => p.email)

  const day = parseDayKey(form.startDate)
  const dayMs = day.getTime()
  const valid = !Number.isNaN(dayMs)
  const winStart = valid ? localDayAt(dayMs, STRIP_FROM) : 0
  const winEnd = valid ? localDayAt(dayMs, STRIP_TO) : 0

  const q = useQuery({
    queryKey: ['calendar', 'freebusy', accountId, emails.join(','), dayMs, excludeObjectId],
    queryFn: () => loadBusy(accountId, emails, dayMs, addDays(day, 1).getTime(), excludeObjectId),
    enabled: valid && !form.allDay,
    staleTime: 30_000,
    retry: false
  })

  if (form.allDay || !valid) return null

  const evStart = wallToLocalMs(form.startDate, form.startTime)
  const evEnd = wallToLocalMs(form.endDate, form.endTime)
  const span = winEnd - winStart
  const marker =
    Number.isFinite(evStart) && Number.isFinite(evEnd) && evEnd > evStart
      ? {
          left: Math.max(0, Math.min(1, (evStart - winStart) / span)),
          right: Math.max(0, Math.min(1, (evEnd - winStart) / span))
        }
      : null

  const busyOf = (p: Person): BusyIntervalDto[] | null => {
    if (!q.data) return null
    if (p.me) return q.data.me
    const r = q.data.others.find((x) => x.email === p.email)
    return r && r.source !== 'unavailable' ? r.busy : null
  }

  const findNext = async (): Promise<void> => {
    if (finding) return
    setFinding(true)
    setNote(null)
    try {
      const { slot, unknown } = await nextCommonSlot({
        accountId,
        emails,
        durationMs:
          wallAsUtcMs(`${form.endDate}T${form.endTime}:00`) -
          wallAsUtcMs(`${form.startDate}T${form.startTime}:00`),
        excludeObjectId
      })
      if (!slot) setNote(t('cvFbNone'))
      else {
        onMove(slot.startUtc)
        if (unknown > 0) setNote(t('cvFbUnknown', { n: unknown }))
      }
    } catch {
      setNote(t('cvFbFailed'))
    } finally {
      setFinding(false)
    }
  }

  const ticks = [8, 12, 16, 20]
  return (
    <div data-testid="availability-strip">
      <div className="mlabel" style={{ color: 'var(--muted)', marginBottom: 5 }}>
        {t('cvFbHead')}
      </div>
      <div className="tint-card" style={{ padding: '8px 10px' }}>
        {people.map((p) => {
          const busy = busyOf(p)
          const unavailable = q.data && busy === null
          const segs = busy ? stripSegments(busy, winStart, winEnd) : []
          const conflict =
            marker !== null && segs.some((s) => s.to > marker.left && s.from < marker.right)
          return (
            <div key={p.email || 'me'} className="cal-fb-row">
              <span className="cal-fb-name" title={p.email || undefined}>
                {p.label}
              </span>
              <div className="cal-fb-bar" data-unavailable={!!unavailable}>
                {segs.map((s, i) => (
                  <span
                    key={i}
                    className="cal-fb-busy"
                    data-tentative={s.tentative}
                    style={{ left: `${s.from * 100}%`, width: `${(s.to - s.from) * 100}%` }}
                  />
                ))}
                {marker && !unavailable && (
                  <span
                    className="cal-fb-event"
                    data-conflict={conflict}
                    title={t('cvFbThisEvent')}
                    style={{
                      left: `${marker.left * 100}%`,
                      width: `${(marker.right - marker.left) * 100}%`
                    }}
                  />
                )}
                {unavailable && <span className="cal-fb-note">{t('cvFbUnavailable')}</span>}
                {!q.data && !q.isError && <span className="cal-fb-note">{t('cvFbLoading')}</span>}
                {q.isError && <span className="cal-fb-note">{t('cvFbUnavailable')}</span>}
              </div>
            </div>
          )
        })}
        <div className="cal-fb-row" aria-hidden="true">
          <span className="cal-fb-name" />
          <div className="cal-fb-axis">
            {ticks.map((h) => (
              <span
                key={h}
                style={{ left: `${((h - STRIP_FROM) / (STRIP_TO - STRIP_FROM)) * 100}%` }}
              >
                {String(h).padStart(2, '0')}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" style={{ marginTop: 6 }}>
        <button
          type="button"
          className="text-btn"
          disabled={finding || q.isError}
          onClick={() => void findNext()}
        >
          {t('cvFbNext')}
        </button>
        {note && (
          <span className="mmeta" role="status" style={{ color: 'var(--faint)' }}>
            {note}
          </span>
        )}
      </div>
    </div>
  )
}
