import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventSuggestionView } from '@shared/event-suggestion-types'
import { invoke, onPush } from '@renderer/lib/ipc'
import { useI18n, useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { useCalendar } from '@renderer/stores/calendar'
import { usePaper } from '@renderer/stores/paper'
import {
  formatSuggestionWhen,
  formFromSuggestion
} from '@renderer/features/paper/event-suggestion-form'

/**
 * „In den Kalender?"-Karte: kompakter Terminvorschlag aus der Mail-Analyse
 * (nach dem Muster der Aufgaben-Vorschläge). Inhalt kommt aus Mails und ist
 * unvertrauenswürdig → nur Klartext; nichts wird ohne Klick angelegt.
 */

const labelStyle: React.CSSProperties = {
  font: '500 9px var(--mono)',
  letterSpacing: '.6px',
  color: 'var(--muted)',
  minWidth: 52,
  textTransform: 'uppercase'
}
const valueStyle: React.CSSProperties = {
  font: '400 13px/1.45 var(--serif)',
  color: 'var(--body-text)',
  minWidth: 0,
  overflowWrap: 'anywhere'
}
const buttonStyle = (primary: boolean, disabled: boolean): React.CSSProperties => ({
  cursor: disabled ? 'default' : 'pointer',
  font: '500 10px var(--mono)',
  letterSpacing: '.5px',
  padding: '4px 11px',
  border: '1px solid var(--ink)',
  background: primary ? 'var(--ink)' : 'transparent',
  color: primary ? 'var(--sheet)' : 'var(--ink)',
  opacity: disabled ? 0.5 : 1
})

function Card({ s }: { s: EventSuggestionView }): React.JSX.Element {
  const t = useT()
  const lang = useI18n((st) => st.lang)
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['eventSuggestions', s.messageId] })
  }
  const when = formatSuggestionWhen(s, lang)
  const where = [s.location, s.link].filter(Boolean).join(' · ')

  const add = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await invoke('calendar:eventSuggestions:accept', { id: s.id })
      toast.info(t('toastEventAdded', { title: s.title }))
      void queryClient.invalidateQueries({ queryKey: ['calendar'] })
      refresh()
    } catch (error) {
      toast.error(
        `${t('toastEventAddFailed')}${error instanceof Error && error.message ? `: ${error.message}` : ''}`
      )
    } finally {
      setBusy(false)
    }
  }

  const edit = (): void => {
    if (busy) return
    // Der Vorschlag gilt erst als erledigt, wenn der Editor erfolgreich gespeichert hat;
    // Abbrechen lässt ihn unverändert „neu".
    usePaper.getState().setView('calendar')
    useCalendar.getState().openNew(formFromSuggestion(s, s.calendarId), {
      onSaved: () => {
        void invoke('calendar:eventSuggestions:edit', { id: s.id })
          .catch(() => undefined)
          .then(refresh)
      }
    })
  }

  const dismiss = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await invoke('calendar:eventSuggestions:dismiss', { id: s.id })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const done = s.state === 'accepted'
  return (
    <section
      aria-label={t('eventSuggestHead')}
      data-testid="event-suggestion"
      style={{
        border: '1px dashed var(--ink)',
        background: 'var(--sheet)',
        padding: '8px 12px 10px',
        marginBottom: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 4
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ font: '600 9.5px var(--mono)', letterSpacing: '1px' }}>
          {t('eventSuggestHead')}
        </span>
        <span style={{ font: '500 9px var(--mono)', color: 'var(--muted)' }}>
          {s.kind === 'confirmed' ? t('eventSuggestConfirmed') : t('eventSuggestProposed')}
        </span>
      </div>
      <div style={{ font: '600 15px/1.3 var(--serif)', color: 'var(--ink)' }}>{s.title}</div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span style={labelStyle}>{t('eventSuggestWhen')}</span>
        <span style={valueStyle}>{when}</span>
      </div>
      {where && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
          <span style={labelStyle}>{t('eventSuggestWhere')}</span>
          <span style={valueStyle}>{where}</span>
        </div>
      )}
      {done ? (
        <div style={{ font: '500 10px var(--mono)', color: 'var(--muted)', marginTop: 2 }}>
          {t('eventSuggestAdded')}
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => void add()}
            disabled={busy || s.calendarId === null}
            title={s.calendarId === null ? t('eventSuggestNoCalendar') : undefined}
            style={buttonStyle(true, busy || s.calendarId === null)}
          >
            {t('eventSuggestAdd')}
          </button>
          <button type="button" onClick={edit} disabled={busy} style={buttonStyle(false, busy)}>
            {t('eventSuggestEdit')}
          </button>
          <button
            type="button"
            onClick={() => void dismiss()}
            disabled={busy}
            style={buttonStyle(false, busy)}
          >
            {t('eventSuggestDismiss')}
          </button>
        </div>
      )}
    </section>
  )
}

export function EventSuggestionCards({
  messageId
}: {
  messageId: number
}): React.JSX.Element | null {
  const queryClient = useQueryClient()
  const q = useQuery({
    queryKey: ['eventSuggestions', messageId],
    queryFn: () => invoke('calendar:eventSuggestions:get', { messageId }),
    staleTime: 10_000,
    retry: false
  })
  // Die Extraktion läuft im Hintergrund und meldet sich über ai:annotated
  useEffect(
    () =>
      onPush('ai:annotated', ({ messageIds }) => {
        if (messageIds.includes(messageId)) {
          void queryClient.invalidateQueries({ queryKey: ['eventSuggestions', messageId] })
        }
      }),
    [queryClient, messageId]
  )
  const list = q.data?.suggestions ?? []
  if (list.length === 0) return null
  return (
    <div>
      {list.map((s) => (
        <Card key={s.id} s={s} />
      ))}
    </div>
  )
}
