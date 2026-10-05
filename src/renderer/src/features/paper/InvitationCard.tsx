import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { InvitationView, RsvpPartstat } from '@shared/invitation-types'
import { invoke } from '@renderer/lib/ipc'
import { useI18n } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import {
  formatInvitationWhen,
  recurrenceSummary,
  type InviteLang
} from '@renderer/features/paper/invitation-format'

/**
 * Einladungskarte (iMIP) über dem Mailtext. Inhalt kommt aus der Mail und ist
 * unvertrauenswürdig: alles wird als Klartext gesetzt, Links in der
 * Beschreibung sind nicht klickbar, nichts wird ohne Klick in den Kalender
 * übernommen.
 */

const S = {
  de: {
    invitation: 'EINLADUNG',
    cancelled: 'ABGESAGT',
    reply: 'ANTWORT',
    counter: 'GEGENVORSCHLAG',
    when: 'Wann',
    where: 'Wo',
    organizer: 'Organisator',
    attendees: 'Teilnehmende',
    conflicts: 'Überschneidet sich mit',
    accept: 'Zusagen',
    tentative: 'Mit Vorbehalt',
    decline: 'Absagen',
    comment: 'Kommentar',
    commentPh: 'Kommentar an den Organisator (optional)',
    calendar: 'Kalender',
    openInCalendar: 'Im Kalender öffnen',
    remove: 'Aus dem Kalender entfernen',
    outdated: 'Nicht mehr aktuell – es gibt eine neuere Version dieser Einladung.',
    cancelledNote: 'Dieser Termin wurde abgesagt.',
    mismatch: 'Hinweis: Der Absender dieser E-Mail ist nicht der Organisator.',
    serverNote: 'Die Antwort sendet dein Kalenderserver.',
    responded: { ACCEPTED: 'Zugesagt', TENTATIVE: 'Mit Vorbehalt zugesagt', DECLINED: 'Abgesagt' },
    replyLine: {
      ACCEPTED: 'hat zugesagt',
      TENTATIVE: 'hat mit Vorbehalt zugesagt',
      DECLINED: 'hat abgesagt'
    },
    replyApplied: 'Im Termin übernommen.',
    replyIgnored: 'Nicht übernommen (Absender passt nicht oder der Termin ist unbekannt).',
    counterNote: 'Schlägt diese Zeit vor – ändere den Termin im Kalender, um zuzustimmen.',
    sent: 'Antwort gesendet',
    sentServer: 'Antwort aktualisiert',
    failed: 'Die Antwort konnte nicht gesendet werden',
    removed: 'Aus dem Kalender entfernt',
    more: 'weitere',
    noCalendar: 'Kein Kalender mit Schreibzugriff'
  },
  en: {
    invitation: 'INVITATION',
    cancelled: 'CANCELLED',
    reply: 'RESPONSE',
    counter: 'COUNTER PROPOSAL',
    when: 'When',
    where: 'Where',
    organizer: 'Organizer',
    attendees: 'Attendees',
    conflicts: 'Conflicts with',
    accept: 'Accept',
    tentative: 'Tentative',
    decline: 'Decline',
    comment: 'Comment',
    commentPh: 'Optional comment to the organizer',
    calendar: 'Calendar',
    openInCalendar: 'Open in calendar',
    remove: 'Remove from calendar',
    outdated: 'Outdated — a newer version of this invitation exists.',
    cancelledNote: 'This event was cancelled.',
    mismatch: 'Note: the sender of this mail is not the organizer.',
    serverNote: 'Your calendar server sends the reply.',
    responded: { ACCEPTED: 'Accepted', TENTATIVE: 'Tentatively accepted', DECLINED: 'Declined' },
    replyLine: {
      ACCEPTED: 'accepted',
      TENTATIVE: 'tentatively accepted',
      DECLINED: 'declined'
    },
    replyApplied: 'Updated in the event.',
    replyIgnored: 'Not applied (sender does not match or event unknown).',
    counterNote: 'Proposes this time — edit the event in your calendar to agree.',
    sent: 'Reply sent',
    sentServer: 'Reply updated',
    failed: 'Reply failed',
    removed: 'Removed from calendar',
    more: 'more',
    noCalendar: 'No writable calendar'
  }
} as const

const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'baseline' }
const label: React.CSSProperties = {
  font: '500 9px var(--mono)',
  letterSpacing: '.6px',
  color: 'var(--muted)',
  minWidth: 74,
  textTransform: 'uppercase'
}
const value: React.CSSProperties = {
  font: '400 13.5px/1.5 var(--serif)',
  color: 'var(--body-text)',
  minWidth: 0,
  overflowWrap: 'anywhere'
}

function useConflicts(inv: InvitationView, enabled: boolean): string[] {
  const range =
    inv.startUtc !== null && inv.endUtc !== null
      ? { rangeStart: inv.startUtc, rangeEnd: Math.max(inv.endUtc, inv.startUtc + 1) }
      : null
  const q = useQuery({
    queryKey: ['invitationConflicts', inv.id, range?.rangeStart, range?.rangeEnd],
    queryFn: () => invoke('calendar:events:list', range!),
    enabled: enabled && range !== null,
    staleTime: 30_000
  })
  return (q.data?.events ?? [])
    .filter((e) => e.objectId !== inv.localEvent?.objectId && e.status !== 'CANCELLED')
    .map((e) => e.summary || '—')
    .slice(0, 3)
}

function ActionButton({
  children,
  onClick,
  disabled,
  active
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  active?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        cursor: disabled ? 'default' : 'pointer',
        font: '500 10px var(--mono)',
        letterSpacing: '.5px',
        padding: '5px 12px',
        border: '1px solid var(--ink)',
        background: active ? 'var(--ink)' : 'transparent',
        color: active ? 'var(--sheet)' : 'var(--ink)',
        opacity: disabled ? 0.5 : 1
      }}
    >
      {children}
    </button>
  )
}

function Card({ inv }: { inv: InvitationView }): React.JSX.Element {
  const lang: InviteLang = useI18n((s) => s.lang)
  const s = S[lang]
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [showComment, setShowComment] = useState(false)
  const [comment, setComment] = useState('')
  const [calendarId, setCalendarId] = useState<number | null>(null)

  const actionable = inv.method === 'REQUEST' && !inv.outdated
  const calendars = useQuery({
    queryKey: ['calendar:list'],
    queryFn: () => invoke('calendar:list', {}),
    enabled: actionable && !inv.localEvent,
    staleTime: 60_000
  })
  const writable = (calendars.data?.calendars ?? []).filter(
    (c) => !c.readOnly && c.components.includes('VEVENT')
  )
  const chosenCalendar = calendarId ?? inv.suggestedCalendarId
  const conflicts = useConflicts(inv, actionable || inv.method === 'COUNTER')

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['invitations', inv.messageId] })
  }

  const respond = async (partstat: RsvpPartstat): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const res = await invoke('calendar:invitations:respond', {
        invitationId: inv.id,
        partstat,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        ...(chosenCalendar !== null && !inv.localEvent ? { calendarId: chosenCalendar } : {})
      })
      toast.info(res.path === 'server' ? s.sentServer : s.sent)
      refresh()
    } catch (error) {
      toast.error(`${s.failed}: ${error instanceof Error ? error.message : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const removeEvent = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await invoke('calendar:invitations:removeCancelled', { invitationId: inv.id })
      toast.info(s.removed)
      refresh()
    } catch (error) {
      toast.error(`${s.failed}: ${error instanceof Error ? error.message : ''}`)
    } finally {
      setBusy(false)
    }
  }

  const title =
    inv.method === 'CANCEL'
      ? s.cancelled
      : inv.method === 'REPLY'
        ? s.reply
        : inv.method === 'COUNTER'
          ? s.counter
          : s.invitation
  const when = formatInvitationWhen(inv, lang)
  const recurrence = recurrenceSummary(inv.rrule, lang)
  const current = inv.respondedPartstat ?? inv.localEvent?.myPartstat ?? inv.myPartstat
  const answered = (['ACCEPTED', 'TENTATIVE', 'DECLINED'] as const).find((p) => p === current)
  const struck = inv.method === 'CANCEL' || inv.outdated

  return (
    <section
      aria-label={title}
      data-testid="invitation-card"
      style={{
        border: '1px solid var(--ink)',
        background: 'var(--sheet)',
        padding: '10px 14px 12px',
        marginBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 6
      }}
    >
      <div style={{ ...row, justifyContent: 'space-between' }}>
        <span style={{ font: '600 9.5px var(--mono)', letterSpacing: '1px' }}>{title}</span>
        {answered && inv.method === 'REQUEST' && (
          <span style={{ font: '500 9.5px var(--mono)', color: 'var(--muted)' }}>
            {s.responded[answered]}
          </span>
        )}
      </div>
      <div
        style={{
          font: '600 17px/1.3 var(--serif)',
          color: 'var(--ink)',
          textDecoration: struck ? 'line-through' : 'none'
        }}
      >
        {inv.summary ?? '—'}
      </div>

      {inv.outdated && <Note>{s.outdated}</Note>}
      {inv.method === 'CANCEL' && !inv.outdated && <Note>{s.cancelledNote}</Note>}
      {inv.senderMismatch && <Note warn>{s.mismatch}</Note>}

      {inv.method === 'REPLY' && inv.reply && (
        <div style={value}>
          <strong>{inv.reply.name ?? inv.reply.email}</strong>{' '}
          {(s.replyLine as Record<string, string>)[inv.reply.partstat] ?? inv.reply.partstat}
          <div style={{ font: '400 11px var(--mono)', color: 'var(--muted)', marginTop: 2 }}>
            {inv.state === 'reply-applied' ? s.replyApplied : s.replyIgnored}
          </div>
        </div>
      )}
      {inv.method === 'COUNTER' && <Note>{s.counterNote}</Note>}

      {when && (
        <div style={row}>
          <span style={label}>{s.when}</span>
          <span style={value}>
            {when}
            {recurrence && (
              <span style={{ color: 'var(--muted)' }}>
                {' · '}
                {recurrence}
              </span>
            )}
          </span>
        </div>
      )}
      {inv.location && (
        <div style={row}>
          <span style={label}>{s.where}</span>
          <span style={value}>{inv.location}</span>
        </div>
      )}
      {inv.organizer && (
        <div style={row}>
          <span style={label}>{s.organizer}</span>
          <span style={value}>
            {inv.organizer.name
              ? `${inv.organizer.name} <${inv.organizer.email}>`
              : inv.organizer.email}
          </span>
        </div>
      )}
      {inv.attendeeCount > 0 && inv.method !== 'REPLY' && (
        <div style={row}>
          <span style={label}>{s.attendees}</span>
          <span style={value}>
            {inv.attendeeCount}
            <span style={{ color: 'var(--muted)' }}>
              {' · '}
              {inv.attendees
                .slice(0, 4)
                .map((a) => a.name ?? a.email)
                .join(', ')}
              {inv.attendeeCount > 4 ? ` +${inv.attendeeCount - 4} ${s.more}` : ''}
            </span>
          </span>
        </div>
      )}
      {inv.description && (
        <div
          style={{
            ...value,
            font: '400 12.5px/1.55 var(--serif)',
            color: 'var(--muted)',
            whiteSpace: 'pre-wrap',
            maxHeight: 96,
            overflow: 'hidden'
          }}
        >
          {inv.description.slice(0, 400)}
          {inv.description.length > 400 ? '…' : ''}
        </div>
      )}
      {conflicts.length > 0 && actionable && (
        <div style={{ ...row, color: '#b3261e' }}>
          <span style={label}>{s.conflicts}</span>
          <span style={{ ...value, color: 'inherit' }}>{conflicts.join(', ')}</span>
        </div>
      )}

      {actionable && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <ActionButton
              disabled={busy}
              active={answered === 'ACCEPTED'}
              onClick={() => void respond('ACCEPTED')}
            >
              {s.accept.toUpperCase()}
            </ActionButton>
            <ActionButton
              disabled={busy}
              active={answered === 'TENTATIVE'}
              onClick={() => void respond('TENTATIVE')}
            >
              {s.tentative.toUpperCase()}
            </ActionButton>
            <ActionButton
              disabled={busy}
              active={answered === 'DECLINED'}
              onClick={() => void respond('DECLINED')}
            >
              {s.decline.toUpperCase()}
            </ActionButton>
            <button type="button" className="text-btn" onClick={() => setShowComment((v) => !v)}>
              {s.comment}
            </button>
            {inv.localEvent && (
              <button
                type="button"
                className="text-btn"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('calendar:openEvent', {
                      detail: {
                        objectId: inv.localEvent!.objectId,
                        recurrenceId: inv.localEvent!.recurrenceId
                      }
                    })
                  )
                }
              >
                {s.openInCalendar} · {inv.localEvent.calendarName}
              </button>
            )}
          </div>
          {showComment && (
            <textarea
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
              placeholder={s.commentPh}
              rows={2}
              style={{
                font: '400 13px var(--serif)',
                border: '1px solid var(--hairline)',
                background: 'transparent',
                padding: 6,
                resize: 'vertical'
              }}
            />
          )}
          {!inv.localEvent && writable.length > 1 && (
            <label style={{ ...row, alignItems: 'center' }}>
              <span style={label}>{s.calendar}</span>
              <select
                value={chosenCalendar ?? ''}
                onChange={(e) => setCalendarId(Number(e.target.value))}
                style={{ font: '400 12px var(--mono)', background: 'transparent' }}
              >
                {writable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName}
                  </option>
                ))}
              </select>
            </label>
          )}
          {!inv.localEvent && calendars.data && writable.length === 0 && (
            <Note warn>{s.noCalendar}</Note>
          )}
          {inv.serverHandlesReply && <Note>{s.serverNote}</Note>}
        </div>
      )}

      {inv.method === 'CANCEL' && inv.localEvent && inv.state !== 'removed' && !inv.outdated && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <ActionButton disabled={busy} onClick={() => void removeEvent()}>
            {s.remove.toUpperCase()}
          </ActionButton>
        </div>
      )}
      {inv.method === 'REPLY' && inv.localEvent && (
        <button
          type="button"
          className="text-btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent('calendar:openEvent', {
                detail: { objectId: inv.localEvent!.objectId, recurrenceId: inv.recurrenceId }
              })
            )
          }
        >
          {s.openInCalendar}
        </button>
      )}
    </section>
  )
}

function Note({
  children,
  warn
}: {
  children: React.ReactNode
  warn?: boolean
}): React.JSX.Element {
  return (
    <div
      style={{
        font: '400 11px/1.4 var(--mono)',
        color: warn ? '#b3261e' : 'var(--muted)'
      }}
    >
      {children}
    </div>
  )
}

/** Mount-Punkt in EmailSheet: rendert nichts, solange die Mail keine Einladung enthält. */
export function InvitationCards({ messageId }: { messageId: number }): React.JSX.Element | null {
  const q = useQuery({
    queryKey: ['invitations', messageId],
    queryFn: () => invoke('calendar:invitations:get', { messageId }),
    staleTime: 10_000,
    retry: false
  })
  const list = q.data?.invitations ?? []
  if (list.length === 0) return null
  return (
    <div>
      {list.map((inv) => (
        <Card key={inv.id} inv={inv} />
      ))}
    </div>
  )
}
