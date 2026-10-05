import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import type { ThreadListItem } from '@shared/types'
import { invoke, onPush } from '@renderer/lib/ipc'
import { saveComposeDraft } from '@renderer/lib/composeDraft'
import { removeDraft } from '@renderer/features/paper/draft-autosave'
import { t } from '@renderer/lib/i18n'
import { usePaper } from './paper'
import { toast } from './toast'

interface PendingSend {
  outboxId: number
  sendAt: number
  accountId: number
  /** Absender-Adresse — für Countdown-Toast und Versandbestätigung. */
  fromAddr: string
  subject: string
  to: string[]
  /** Antwort-Kontext: Thread erst nach echtem Versand archivieren. */
  archive?: { threadKey: string; messageIds: number[] }
}

// Aufgeschobene Archivierungen je Outbox-Eintrag: beim Einreihen wird der
// Thread nur versteckt; archiviert wird erst, wenn der Versand wirklich
// draußen ist — Rückgängig holt Thread und Entwurf unversehrt zurück.
const stagedArchives = new Map<number, { threadKey: string; messageIds: number[] }>()

/** Staging auflösen, ohne zu archivieren (Rückgängig oder Versandfehler). */
function unstageArchive(outboxId: number): { threadKey: string } | null {
  const staged = stagedArchives.get(outboxId)
  if (!staged) return null
  stagedArchives.delete(outboxId)
  usePaper.getState().setThreadHidden(staged.threadKey, false)
  return { threadKey: staged.threadKey }
}

// Countdown-Toast je Outbox-Eintrag: begin() legt ihn an, der Lebenszyklus
// (sent/canceled/error) räumt ihn wieder ab und liefert dabei die Adresse
// für die Bestätigung zurück.
const sendToasts = new Map<number, { toastId: number; fromAddr: string }>()

function dropSendToast(outboxId: number): { fromAddr: string } | null {
  const entry = sendToasts.get(outboxId)
  if (!entry) return null
  sendToasts.delete(outboxId)
  toast.dismiss(entry.toastId)
  return { fromAddr: entry.fromAddr }
}

/** Fehlversand einer Antwort: zurück zum Thread, den gesicherten Entwurf
 *  (M37) wieder in den Antwort-Composer legen. Der Lade-Effekt im EmailSheet
 *  greift nur beim Threadwechsel — steht der Nutzer schon auf dem Thread,
 *  wird der Entwurf hier explizit geladen. */
async function openFailedDraft(threadKey: string): Promise<void> {
  const paper = usePaper.getState()
  paper.setMbox('inbox')
  paper.setView('inbox')
  paper.setSelThreadKey(threadKey)
  const c = usePaper.getState().comp
  // Einen bereits beladenen oder aktiven Composer nie überschreiben
  if (c.threadKey === threadKey && c.text.trim()) return
  if (c.mode !== 'idle' && c.mode !== 'ready') return
  const { drafts } = await invoke('drafts:list', undefined)
  const saved = drafts.find((d) => d.threadKey === threadKey)
  if (!saved) return
  paper.resetComp()
  paper.setComp({ mode: 'ready', threadKey, text: saved.text, html: saved.html, manual: true })
}

/** Optimistischer Platzhalter in der Gesendet-Liste, bis die Server-Kopie gesynct ist. */
export interface SentEcho {
  outboxId: number
  accountId: number
  subject: string
  toNames: string[]
  date: number
  state: 'pending' | 'sending' | 'sent' | 'error' | 'unknown'
}

interface SendState {
  pending: PendingSend | null
  echoes: SentEcho[]
  begin: (send: PendingSend) => void
  cancel: (outboxId: number) => Promise<void>
  clear: (outboxId: number) => void
  setEchoState: (outboxId: number, state: 'sending' | 'sent' | 'error' | 'unknown') => void
  dropEcho: (outboxId: number) => void
}

// Fallback-Timer: kein Echo bleibt ewig stehen, falls die Server-Kopie nie eintrifft
const echoTimers = new Map<number, ReturnType<typeof setTimeout>>()
function scheduleEchoDrop(outboxId: number, ms: number): void {
  const prev = echoTimers.get(outboxId)
  if (prev) clearTimeout(prev)
  echoTimers.set(
    outboxId,
    setTimeout(() => useSendState.getState().dropEcho(outboxId), ms)
  )
}

export const useSendState = create<SendState>((set, get) => ({
  pending: null,
  echoes: [],
  begin: (send) => {
    if (send.archive) {
      stagedArchives.set(send.outboxId, send.archive)
      usePaper.getState().setThreadHidden(send.archive.threadKey, true)
    }
    // Undo-Send als Countdown-Toast: UNDO/⌘Z stornieren; nach Ablauf des
    // Fensters wechselt die Toast selbst auf „Geht gerade raus…".
    const toastId = toast.countdown({
      until: send.sendAt,
      textFor: (n) => t('toastSendingIn', { addr: send.fromAddr, n }),
      doneText: t('toastSending'),
      action: {
        label: t('toastUndo'),
        kbd: '⌘Z',
        run: () => void useSendState.getState().cancel(send.outboxId)
      }
    })
    sendToasts.set(send.outboxId, { toastId, fromAddr: send.fromAddr })
    set({
      pending: send,
      echoes: [
        {
          outboxId: send.outboxId,
          accountId: send.accountId,
          subject: send.subject,
          toNames: send.to,
          date: Date.now(),
          state: 'pending'
        },
        ...get().echoes
      ]
    })
  },
  cancel: async (outboxId) => {
    // Vor dem Cancel merken: läuft für diesen Versand eine aufgeschobene
    // Archivierung (= Antwort auf einen Thread)?
    const staged = stagedArchives.get(outboxId) ?? null
    const result = await invoke('outbox:cancel', { outboxId })
    if (result.ok) {
      get().dropEcho(outboxId)
      // Countdown-Toast still abräumen — die Composer-Rückkehr ist das Feedback
      dropSendToast(outboxId)
    }
    if (result.ok && staged) {
      // Antwort: Thread wieder zeigen, auswählen und den Entwurf zurück in
      // den Antwort-Composer legen — nicht in die leere Compose-Ansicht.
      unstageArchive(outboxId)
      const paper = usePaper.getState()
      if (result.draft) {
        paper.resetComp()
        paper.setComp({
          mode: 'ready',
          threadKey: staged.threadKey,
          text: result.draft.textBody,
          html: result.draft.htmlBody ?? '',
          manual: true
        })
      }
      paper.setMbox('inbox')
      paper.setView('inbox')
      paper.setSelThreadKey(staged.threadKey)
    } else if (result.ok && result.draft && result.accountId !== null) {
      // Neue Mail (ComposeSheet): Entwurf zurück in den Composer — außer der
      // Composer ist gerade mit einer anderen Mail belegt
      if (usePaper.getState().view !== 'compose') {
        await saveComposeDraft({
          accountId: result.accountId,
          to: result.draft.to,
          cc: result.draft.cc,
          bcc: result.draft.bcc,
          subject: result.draft.subject,
          body: result.draft.textBody,
          html: result.draft.htmlBody ?? '',
          replyToMessageId: result.draft.replyToMessageId
        })
        usePaper.getState().setView('compose')
      }
    }
    get().clear(outboxId)
  },
  clear: (outboxId) => {
    if (get().pending?.outboxId !== outboxId) return
    set({ pending: null })
  },
  setEchoState: (outboxId, state) => {
    if (get().echoes.some((e) => e.outboxId === outboxId)) {
      set({ echoes: get().echoes.map((e) => (e.outboxId === outboxId ? { ...e, state } : e)) })
      if (state === 'sent') scheduleEchoDrop(outboxId, 90_000)
      else if (state === 'error') scheduleEchoDrop(outboxId, 10_000)
      else if (state === 'unknown') scheduleEchoDrop(outboxId, 60_000)
    }
  },
  dropEcho: (outboxId) => {
    const timer = echoTimers.get(outboxId)
    if (timer) clearTimeout(timer)
    echoTimers.delete(outboxId)
    if (get().echoes.some((e) => e.outboxId === outboxId)) {
      set({ echoes: get().echoes.filter((e) => e.outboxId !== outboxId) })
    }
  }
}))

/**
 * Erkennt die vom Server zurückgesyncte Kopie eines Echos in der Gesendet-Liste:
 * gleiches Konto, Datum nicht vor dem Absenden, Betreff gleich (Re:/Aw:-Präfixe
 * ignoriert, damit Antworten auf den aggregierten Thread-Betreff passen).
 */
export function echoConfirmedBy(echo: SentEcho, item: ThreadListItem): boolean {
  if (echo.state !== 'sent') return false
  if (item.accountId !== echo.accountId || item.date < echo.date - 60_000) return false
  const norm = (s: string | null): string =>
    (s ?? '')
      .replace(/^((re|aw|fwd?|wg)\s*:\s*)+/i, '')
      .trim()
      .toLowerCase()
  return norm(item.subject) === norm(echo.subject)
}

/** Spiegelt Outbox-Zustandswechsel aus dem Main-Prozess in die Echos (einmal app-weit mounten). */
export function useOutboxEchoLifecycle(): void {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('outbox:changed', ({ outboxId, state }) => {
        const st = useSendState.getState()
        if (state === 'canceled') {
          st.dropEcho(outboxId)
          // cancel() übernimmt die Entwurf-Wiederherstellung; hier nur
          // sicherstellen, dass Thread und Countdown-Toast nicht hängen bleiben.
          unstageArchive(outboxId)
          dropSendToast(outboxId)
        } else if (state !== 'pending') {
          st.setEchoState(outboxId, state)
          if (state === 'sent') {
            // Bestätigung als Info-Toast (der Countdown ist längst umgeschwenkt)
            const sent = dropSendToast(outboxId)
            if (sent) toast.info(t('toastSentAs', { addr: sent.fromAddr }))
            // Versand ist wirklich draußen → Archivierung jetzt ausführen
            const staged = stagedArchives.get(outboxId)
            if (staged) {
              stagedArchives.delete(outboxId)
              void invoke('messages:action', {
                messageIds: staged.messageIds,
                action: 'archive'
              }).then(() => {
                removeDraft(staged.threadKey)
                usePaper.getState().setThreadHidden(staged.threadKey, false)
                void queryClient.invalidateQueries({ queryKey: ['threads'] })
              })
            }
          } else if (state === 'unknown') {
            // Ausgang ungewiss: Thread wieder zeigen, aber nichts automatisch
            // erneut senden — der Nutzer prüft den Gesendet-Ordner.
            unstageArchive(outboxId)
            dropSendToast(outboxId)
            toast.error(t('toastSendUnknown'))
          } else if (state === 'error') {
            // Mail ging nicht raus → Thread wieder zeigen; der gespeicherte
            // Entwurf bleibt erhalten und lädt beim Öffnen zurück. Der
            // Fehler-Toast bietet bei Antworten den Sprung dorthin an —
            // ehrlicher als ein RETRY, das es als IPC nicht gibt.
            const restored = unstageArchive(outboxId)
            dropSendToast(outboxId)
            toast.error(
              t('toastSendFailed'),
              restored
                ? {
                    action: {
                      label: t('toastOpenDraft'),
                      run: () => void openFailedDraft(restored.threadKey)
                    }
                  }
                : {}
            )
          }
        }
      }),
    [queryClient]
  )
}
