import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarAttendee } from '@shared/calendar-types'
import type { RsvpPartstat } from '@shared/invitation-types'
import type { StringKey } from '@renderer/i18n/strings'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import { invalidateCalendarData } from '@renderer/queries/calendar'
import {
  addAttendee,
  isValidAttendeeEmail,
  normEmail,
  removeAttendee,
  roleOf,
  setAttendeeRole,
  type AttendeeRole
} from './attendees'

// Teilnehmer im Termin-Editor. Organisator: Liste mit Autocomplete (Adressbuch + Mail-
// Historie über contacts:suggest), Rolle Pflicht/optional und Antwortstand je Teilnehmer.
// Sonst: schreibgeschützte Liste und — stammt der Termin aus einer Einladung — meine
// Antwort-Knöpfe (derselbe IPC wie die Einladungskarte in der Mail).

const PARTSTAT_KEYS: Record<string, StringKey> = {
  ACCEPTED: 'cvPartAccepted',
  DECLINED: 'cvPartDeclined',
  TENTATIVE: 'cvPartTentative',
  'NEEDS-ACTION': 'cvPartNeeds',
  DELEGATED: 'cvPartDelegated'
}

function PartChip({ partstat, isNew }: { partstat: string; isNew: boolean }): React.JSX.Element {
  const t = useT()
  const key = PARTSTAT_KEYS[partstat.toUpperCase()]
  const accepted = partstat.toUpperCase() === 'ACCEPTED'
  const declined = partstat.toUpperCase() === 'DECLINED'
  return (
    <span
      className="mchip flex-none"
      style={{
        color: declined ? 'var(--ac)' : accepted ? 'var(--ink)' : 'var(--muted)',
        border: accepted ? '1px solid var(--hairline)' : undefined
      }}
    >
      {isNew ? t('cvPartNew') : key ? t(key) : partstat.toLowerCase()}
    </span>
  )
}

function Row({
  a,
  isNew,
  editable,
  onRole,
  onRemove
}: {
  a: CalendarAttendee
  isNew: boolean
  editable: boolean
  onRole: (role: AttendeeRole) => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useT()
  const role = roleOf(a)
  return (
    <div
      className="flex items-center gap-2"
      style={{ font: '400 12px var(--serif)', marginTop: 4 }}
      data-testid="attendee-row"
    >
      <span className="min-w-0 flex-1 truncate" title={a.email}>
        {a.name || a.email}
      </span>
      {editable && role !== 'OTHER' ? (
        <select
          className="paper-input flex-none"
          style={{ width: 'auto', padding: '0 2px', font: '500 9.5px var(--mono)' }}
          aria-label={t('cvAttendeeRole', { addr: a.email })}
          value={role}
          onChange={(e) => onRole(e.target.value as AttendeeRole)}
        >
          <option value="REQ-PARTICIPANT">{t('cvRoleReq')}</option>
          <option value="OPT-PARTICIPANT">{t('cvRoleOpt')}</option>
        </select>
      ) : (
        <span className="mmeta flex-none">
          {role === 'OPT-PARTICIPANT'
            ? t('cvRoleOpt')
            : role === 'OTHER'
              ? t('cvRoleOther')
              : t('cvRoleReq')}
        </span>
      )}
      <PartChip partstat={a.partstat} isNew={isNew} />
      {editable && (
        <button
          type="button"
          className="btn-bare flex-none"
          style={{ font: '500 13px var(--mono)', color: 'var(--faint)', lineHeight: 1 }}
          aria-label={t('cvAttendeeRemove', { addr: a.email })}
          title={t('cvAttendeeRemove', { addr: a.email })}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </div>
  )
}

/** Eingabefeld mit Vorschlägen aus Adressbuch und Mail-Historie (contacts:suggest). */
function AttendeeInput({
  onPick,
  taken
}: {
  onPick: (email: string, name: string | null) => void
  taken: ReadonlySet<string>
}): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // Kurzes Debounce, damit nicht jeder Tastendruck eine IPC-Abfrage auslöst
  useEffect(() => {
    const h = setTimeout(() => setQuery(text.trim()), 120)
    return () => clearTimeout(h)
  }, [text])

  const q = useQuery({
    queryKey: ['contacts:suggest', query],
    queryFn: () => invoke('contacts:suggest', { q: query, limit: 6 }),
    enabled: query.length >= 1,
    staleTime: 0,
    placeholderData: (prev) => prev
  })
  const suggestions = useMemo(
    () => (q.data?.contacts ?? []).filter((s) => !taken.has(normEmail(s.addr))),
    [q.data, taken]
  )

  const sig = `${query}\u0000${suggestions.length}`
  const [prevSig, setPrevSig] = useState(sig)
  if (prevSig !== sig) {
    setPrevSig(sig)
    setActive(0)
    setOpen(query.length >= 1 && suggestions.length > 0)
  }

  const commit = (email: string, name: string | null): void => {
    onPick(email, name)
    setText('')
    setQuery('')
    setOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className="relative" style={{ marginTop: 6 }}>
      <input
        ref={inputRef}
        type="text"
        className="paper-input"
        placeholder={t('cvAttendeeAddPh')}
        aria-label={t('cvAttendeeAddPh')}
        value={text}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          // Eine vollständige Adresse nicht verlieren, wenn der Fokus woandershin geht
          if (isValidAttendeeEmail(text)) commit(text, null)
          else setOpen(false)
        }}
        onKeyDown={(e) => {
          if (open && e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => Math.min(i + 1, suggestions.length - 1))
          } else if (open && e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            const pick = open ? suggestions[active] : undefined
            // Enter im Feld darf den Editor nie abschicken
            e.preventDefault()
            e.stopPropagation()
            if (pick) commit(pick.addr, pick.name)
            else if (isValidAttendeeEmail(text)) commit(text, null)
          } else if (e.key === 'Escape' && open) {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
          }
        }}
      />
      {open && (
        <div
          className="suggest-pop anim-rise absolute left-0 z-50 mt-1 w-full overflow-hidden"
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <button
              key={s.addr}
              type="button"
              role="option"
              aria-selected={i === active}
              // onMouseDown statt onClick: feuert vor dem Blur des Eingabefelds
              onMouseDown={(e) => {
                e.preventDefault()
                commit(s.addr, s.name)
              }}
              onMouseEnter={() => setActive(i)}
              className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left"
              style={i === active ? { background: 'var(--highlight)' } : undefined}
            >
              {s.name ? (
                <>
                  <span className="truncate" style={{ font: '500 12px var(--serif)' }}>
                    {s.name}
                  </span>
                  <span className="mmeta truncate">{s.addr}</span>
                </>
              ) : (
                <span className="truncate" style={{ font: '400 12px var(--serif)' }}>
                  {s.addr}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function RsvpButtons({
  invitationId,
  current,
  onAnswered
}: {
  invitationId: number
  current: string | null
  onAnswered: (partstat: RsvpPartstat) => void
}): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const answer = (partstat: RsvpPartstat): void => {
    if (busy) return
    setBusy(true)
    invoke('calendar:invitations:respond', { invitationId, partstat })
      .then(() => {
        toast.info(t('cvRsvpSent'))
        invalidateCalendarData(queryClient)
        void queryClient.invalidateQueries({ queryKey: ['calendar', 'scheduling'] })
        onAnswered(partstat)
      })
      .catch((err: unknown) => {
        toast.error(
          t('cvRsvpFailed', {
            err: cleanIpcError(err instanceof Error ? err.message : String(err))
          })
        )
      })
      .finally(() => setBusy(false))
  }
  const opts: Array<[RsvpPartstat, StringKey]> = [
    ['ACCEPTED', 'cvRsvpYes'],
    ['TENTATIVE', 'cvRsvpMaybe'],
    ['DECLINED', 'cvRsvpNo']
  ]
  return (
    <div style={{ marginTop: 10 }}>
      <div className="mlabel" style={{ color: 'var(--muted)', marginBottom: 5 }}>
        {t('cvRsvpHead')}
      </div>
      <div className="flex gap-1.5" role="group" aria-label={t('cvRsvpHead')}>
        {opts.map(([p, key]) => (
          <button
            key={p}
            type="button"
            className="cal-scope-btn"
            style={{ flex: 1, textAlign: 'center' }}
            aria-pressed={current?.toUpperCase() === p}
            data-on={current?.toUpperCase() === p}
            disabled={busy}
            onClick={() => answer(p)}
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  )
}

export function AttendeesSection({
  attendees,
  baseline,
  organizer,
  mine,
  editable,
  onChange,
  invitation,
  myState,
  onAnswered
}: {
  attendees: readonly CalendarAttendee[]
  /** Teilnehmer beim Öffnen: neu hinzugefügte zeigen „neu" statt „offen" */
  baseline: readonly CalendarAttendee[]
  organizer: { email: string; name: string | null } | null
  mine: ReadonlySet<string>
  editable: boolean
  onChange: (list: CalendarAttendee[]) => void
  invitation: { id: number } | null
  /** Meine aktuelle Antwort (PARTSTAT) */
  myState: string | null
  onAnswered: (partstat: RsvpPartstat) => void
}): React.JSX.Element {
  const t = useT()
  const known = new Set(baseline.map((a) => normEmail(a.email)))
  const taken = useMemo(() => {
    const s = new Set(attendees.map((a) => normEmail(a.email)))
    for (const m of mine) s.add(m)
    return s
  }, [attendees, mine])
  const isMe = organizer !== null && mine.has(normEmail(organizer.email))
  return (
    <div>
      <div className="tint-card" style={{ padding: '8px 10px' }}>
        {organizer && (
          <div className="flex items-baseline gap-2" style={{ font: '400 12px var(--serif)' }}>
            <span className="min-w-0 flex-1 truncate" title={organizer.email}>
              {organizer.name || organizer.email}
              {isMe && <span className="mmeta"> ({t('cvYou')})</span>}
            </span>
            <span className="mchip" style={{ border: '1px solid var(--hairline)' }}>
              {t('cvOrganizer')}
            </span>
          </div>
        )}
        {attendees.map((a) => (
          <Row
            key={normEmail(a.email)}
            a={a}
            isNew={!known.has(normEmail(a.email))}
            editable={editable}
            onRole={(role) => onChange(setAttendeeRole(attendees, a.email, role))}
            onRemove={() => onChange(removeAttendee(attendees, a.email))}
          />
        ))}
        {attendees.length === 0 && !editable && (
          <div className="mmeta">{t('cvAttendees').toLowerCase()}: –</div>
        )}
      </div>
      {editable ? (
        <AttendeeInput
          onPick={(email, name) => onChange(addAttendee(attendees, email, name, mine))}
          taken={taken}
        />
      ) : (
        <div className="mmeta" style={{ marginTop: 5, color: 'var(--faint)' }}>
          {t('cvOrganizerOnly')}
        </div>
      )}
      {!editable && invitation && (
        <RsvpButtons invitationId={invitation.id} current={myState} onAnswered={onAnswered} />
      )}
    </div>
  )
}
