import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MailAuthenticationStatus,
  MessageDetail,
  MessageHeaderDetails,
  Recipient
} from '@shared/types'
import { invoke, onPush } from '@renderer/lib/ipc'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useThread, useThreads } from '@renderer/queries/threads'
import { useAccounts } from '@renderer/queries/accounts'
import { useDrafts } from '@renderer/queries/drafts'
import { removeDraft } from '@renderer/features/paper/draft-autosave'
import { ARCHIVE_UNDO_WINDOW_MS, usePaper } from '@renderer/stores/paper'
import { toast } from '@renderer/stores/toast'
import { SheetEmpty } from '@renderer/components/paper/SheetEmpty'
import { useI18n, useT, rowTime, formatGap } from '@renderer/lib/i18n'
import { useSendState } from '@renderer/stores/send'
import { MailFrame } from '@renderer/components/MailFrame'
import { useVoiceTag } from '@renderer/features/paper/useVoiceTag'
import { splitHtmlQuote, splitTextQuote } from '@renderer/lib/quotes'
import { useListeningAudio } from '@renderer/features/paper/useListeningAudio'
import {
  MailComposerSurface,
  type ComposerDocument,
  type MailComposerHandle
} from '@renderer/features/composer/MailComposerSurface'
import { composerHtmlForSend } from '@renderer/features/composer/composer-html'
import { useAccountSignature } from '@renderer/features/composer/useAccountSignature'
import {
  appendTranscription,
  appendTranscriptionHtml,
  type ComposerActivity
} from '@renderer/features/composer/composer-state'
import { MessageAttachments } from '@renderer/features/paper/MessageAttachments'
import { InvitationCards } from '@renderer/features/paper/InvitationCard'
import { EventSuggestionCards } from '@renderer/features/paper/EventSuggestionCard'
import { OverrideMenu } from '@renderer/features/inbox/OverrideMenu'
import { useUiStore } from '@renderer/stores/ui'
import {
  buildReplyRecipients,
  dropRecipients,
  mergeRecipientFields
} from '@renderer/lib/reply-recipients'
import { parseAddresses } from '@renderer/features/composer/address-check'
import { RecipientInput } from '@renderer/features/composer/RecipientInput'

/** MailFrame mit cid-Inline-Bildern (lazy) und echter Bild-Freigabe. */
function InlineMailFrame({
  message,
  html
}: {
  message: MessageDetail
  html: string
}): React.JSX.Element {
  const needsCid = html.includes('cid:')
  const inline = useQuery({
    queryKey: ['inlineImages', message.id],
    queryFn: () => invoke('messages:inlineImages', { messageId: message.id }),
    enabled: needsCid,
    staleTime: Infinity
  })
  return (
    <MailFrame
      html={html}
      fromAddr={message.fromAddr}
      inlineImages={inline.data?.images ?? {}}
      remoteImagesAllowed={message.remoteImagesAllowed}
    />
  )
}

/**
 * Geschwungener Pfeil zwischen Nachrichten-Boxen: zeigt nach oben (die
 * jüngere Nachricht steht darüber) und trägt den zeitlichen Abstand.
 */
function ReplyArrow({ gapLabel }: { gapLabel: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2" style={{ padding: '2px 0 2px 26px' }}>
      <svg width="26" height="30" viewBox="0 0 26 30" fill="none" aria-hidden="true">
        <path
          d="M19 29 C 19 16, 15 8, 4 5"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M10.5 2.5 L 3.5 4.6 L 7 10.4"
          stroke="var(--muted)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)', letterSpacing: '.5px' }}>
        {gapLabel}
      </span>
    </div>
  )
}

function fullDate(lang: 'de' | 'en', timestamp: number | null): string {
  if (!timestamp) return '—'
  return new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short'
  }).format(new Date(timestamp))
}

function byteSize(lang: 'de' | 'en', size: number | null): string {
  if (size === null) return '—'
  return new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-GB', {
    style: 'unit',
    unit: size >= 1024 * 1024 ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1
  }).format(size >= 1024 * 1024 ? size / (1024 * 1024) : size / 1024)
}

function addressDomain(address: string): string {
  return address.split('@').at(-1)?.toLowerCase() ?? address.toLowerCase()
}

function sameRecipients(a: Recipient[], b: Recipient[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (recipient, index) => recipient.address.toLowerCase() === b[index]?.address.toLowerCase()
    )
  )
}

function AddressList({ recipients }: { recipients: Recipient[] }): React.JSX.Element {
  if (recipients.length === 0) return <span className="message-details__empty">—</span>
  return (
    <span className="message-details__addresses">
      {recipients.map((recipient, index) => (
        <span className="message-details__address" key={`${recipient.address}-${index}`} dir="ltr">
          {recipient.name && (
            <span className="message-details__address-name">{recipient.name}</span>
          )}
          <span className="message-details__address-email">
            {recipient.name ? `‹${recipient.address}›` : recipient.address}
          </span>
        </span>
      ))}
    </span>
  )
}

function DetailRow({
  label,
  children,
  mono = false
}: {
  label: string
  children: React.ReactNode
  mono?: boolean
}): React.JSX.Element {
  return (
    <div className="message-details__row">
      <dt>{label}</dt>
      <dd className={mono ? 'message-details__mono' : undefined}>{children}</dd>
    </div>
  )
}

function AuthenticationSignal({
  protocol,
  status
}: {
  protocol: 'SPF' | 'DKIM' | 'DMARC'
  status: MailAuthenticationStatus
}): React.JSX.Element {
  const t = useT()
  const tone =
    status === 'pass' ? 'pass' : status === 'unknown' || status === 'none' ? 'unknown' : 'warn'
  const label =
    status === 'pass'
      ? t('mailDetailsAuthPass')
      : status === 'fail'
        ? t('mailDetailsAuthFail')
        : status === 'softfail'
          ? t('mailDetailsAuthSoftfail')
          : status === 'neutral'
            ? t('mailDetailsAuthNeutral')
            : status === 'temperror'
              ? t('mailDetailsAuthTemperror')
              : status === 'permerror'
                ? t('mailDetailsAuthPermerror')
                : status === 'none'
                  ? t('mailDetailsAuthNone')
                  : t('mailDetailsAuthUnknown')
  return (
    <div className="message-auth-signal" data-tone={tone}>
      <span className="message-auth-signal__protocol">{protocol}</span>
      <span className="message-auth-signal__status">{label}</span>
    </div>
  )
}

interface TriageInfo {
  category: string | null
  priority: number | null
  needsReply: boolean
}

/** 5b: TRIAGE-Zeile unter der SECURITY-Sektion — nur wenn eine Annotation existiert. */
function TriageSection({ triage }: { triage: TriageInfo }): React.JSX.Element {
  const t = useT()
  const categoryKey = {
    personal: 'catPersonal',
    work: 'catWork',
    newsletter: 'catNewsletter',
    promotions: 'catPromotions',
    notifications: 'catNotifications',
    transactional: 'catTransactional',
    other: 'catOther'
  }[triage.category ?? ''] as Parameters<typeof t>[0] | undefined
  const n = Math.max(1, Math.min(5, triage.priority ?? 1))
  return (
    <section className="message-details__security">
      <div className="message-details__section-head">
        <span>{t('triageHead')}</span>
      </div>
      <div
        style={{
          font: '500 9px var(--mono)',
          letterSpacing: '.5px',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap'
        }}
      >
        {categoryKey && <span>{t(categoryKey).toUpperCase()}</span>}
        {triage.priority !== null && (
          <>
            <span aria-hidden="true">·</span>
            <span
              style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}
              aria-hidden="true"
            >
              {[1, 2, 3, 4, 5].map((step) => (
                <span
                  key={step}
                  style={{
                    width: 4,
                    height: 9,
                    background:
                      step <= n ? (n === 5 ? 'var(--ac)' : 'var(--ink)') : 'var(--hairline)'
                  }}
                />
              ))}
            </span>
            <span>{t('triagePriority', { n })}</span>
          </>
        )}
        {triage.needsReply && (
          <>
            <span aria-hidden="true">·</span>
            <span>{t('triageNeedsReply')}</span>
          </>
        )}
      </div>
      <div style={{ font: '400 8.5px var(--mono)', color: 'var(--faint)', marginTop: 6 }}>
        {t('prioNote')}
      </div>
    </section>
  )
}

function MessageHeaderDetailsPanel({
  message,
  details,
  loading,
  triage
}: {
  message: MessageDetail
  details: MessageHeaderDetails | undefined
  loading: boolean
  triage?: TriageInfo | null
}): React.JSX.Element {
  const t = useT()
  const lang = useI18n((state) => state.lang)
  const fallbackFrom = message.fromAddr
    ? [{ name: message.fromName, address: message.fromAddr }]
    : []
  const from = details?.from.length ? details.from : fallbackFrom
  const to = details?.to ?? message.to
  const cc = details?.cc ?? message.cc
  const sender = details?.sender ?? []
  const replyTo = details?.replyTo ?? []
  const senderDiffers = sender.length > 0 && !sameRecipients(sender, from)
  const replyDiffers = replyTo.length > 0 && !sameRecipients(replyTo, from)
  const fromDomain = from[0]?.address ? addressDomain(from[0].address) : null
  const replyDomainMismatch = Boolean(
    fromDomain && replyTo.some((recipient) => addressDomain(recipient.address) !== fromDomain)
  )

  return (
    <div className="message-details">
      <div className="message-details__identity">
        <dl className="message-details__column">
          <DetailRow label={t('mailDetailsFrom')}>
            <AddressList recipients={from} />
          </DetailRow>
          {senderDiffers && (
            <DetailRow label={t('mailDetailsSender')}>
              <AddressList recipients={sender} />
            </DetailRow>
          )}
          {replyDiffers && (
            <DetailRow label={t('mailDetailsReplyTo')}>
              <AddressList recipients={replyTo} />
            </DetailRow>
          )}
        </dl>
        <dl className="message-details__column">
          <DetailRow label={t('mailDetailsTo')}>
            <AddressList recipients={to} />
          </DetailRow>
          {cc.length > 0 && (
            <DetailRow label={t('mailDetailsCc')}>
              <AddressList recipients={cc} />
            </DetailRow>
          )}
          {(details?.bcc.length ?? 0) > 0 && (
            <DetailRow label={t('mailDetailsBcc')}>
              <AddressList recipients={details?.bcc ?? []} />
            </DetailRow>
          )}
        </dl>
      </div>

      <dl className="message-details__facts">
        <DetailRow label={t('mailDetailsSubject')}>
          {details?.subject ?? message.subject ?? '—'}
        </DetailRow>
        <DetailRow label={t('mailDetailsSent')}>
          {fullDate(lang, details?.sentAt ?? message.date)}
        </DetailRow>
        {details?.receivedAt && (
          <DetailRow label={t('mailDetailsReceived')}>
            {fullDate(lang, details.receivedAt)}
          </DetailRow>
        )}
        {details && (
          <DetailRow label={t('mailDetailsSize')}>{byteSize(lang, details.size)}</DetailRow>
        )}
        {details?.messageIdHeader && (
          <DetailRow label={t('mailDetailsMessageId')} mono>
            {details.messageIdHeader}
          </DetailRow>
        )}
      </dl>

      <section className="message-details__security" aria-busy={loading}>
        <div className="sr-only" role="status" aria-live="polite">
          {loading
            ? t('mailDetailsLoading')
            : details?.technicalAvailable
              ? t('mailDetailsLoaded')
              : t('mailDetailsUnavailable')}
        </div>
        <div className="message-details__section-head">
          <span>{t('mailDetailsSecurity')}</span>
          <small>{t('mailDetailsSecurityNote')}</small>
        </div>
        {loading ? (
          <div className="message-details__skeleton" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
        ) : details?.technicalAvailable ? (
          <>
            <div className="message-auth-grid">
              <AuthenticationSignal protocol="SPF" status={details.authentication.spf} />
              <AuthenticationSignal protocol="DKIM" status={details.authentication.dkim} />
              <AuthenticationSignal protocol="DMARC" status={details.authentication.dmarc} />
            </div>
            {replyDomainMismatch && (
              <div className="message-details__notice">↳ {t('mailDetailsReplyMismatch')}</div>
            )}
            <dl className="message-details__technical-grid">
              {details.authentication.mailedBy && (
                <DetailRow label={t('mailDetailsMailedBy')} mono>
                  {details.authentication.mailedBy}
                </DetailRow>
              )}
              {details.authentication.signedBy && (
                <DetailRow label={t('mailDetailsSignedBy')} mono>
                  {details.authentication.signedBy}
                </DetailRow>
              )}
              {details.authentication.reportedBy && (
                <DetailRow label={t('mailDetailsReportedBy')} mono>
                  {details.authentication.reportedBy}
                </DetailRow>
              )}
              {details.returnPath && (
                <DetailRow label={t('mailDetailsReturnPath')} mono>
                  {details.returnPath}
                </DetailRow>
              )}
              {details.deliveredTo.length > 0 && (
                <DetailRow label={t('mailDetailsDeliveredTo')} mono>
                  {details.deliveredTo.join(' · ')}
                </DetailRow>
              )}
            </dl>
            {details.received.length > 0 && (
              <details className="message-details__technical-disclosure">
                <summary>{t('mailDetailsReceivedPath', { n: details.received.length })}</summary>
                <ol>
                  {details.received.map((hop, index) => (
                    <li key={`${hop}-${index}`} dir="ltr">
                      {hop}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            {details.spamHeaders.length > 0 && (
              <details className="message-details__technical-disclosure">
                <summary>{t('mailDetailsSpamSignals')}</summary>
                <dl>
                  {details.spamHeaders.map((header, index) => (
                    <DetailRow label={header.name} mono key={`${header.name}-${index}`}>
                      {header.value}
                    </DetailRow>
                  ))}
                </dl>
              </details>
            )}
            {details.rawHeaders && (
              <details className="message-details__raw">
                <summary>{t('mailDetailsRaw')}</summary>
                {details.rawHeadersTruncated && (
                  <div className="message-details__raw-note">{t('mailDetailsRawTruncated')}</div>
                )}
                <pre dir="ltr">{details.rawHeaders}</pre>
              </details>
            )}
          </>
        ) : (
          <div className="message-details__unavailable">{t('mailDetailsUnavailable')}</div>
        )}
      </section>
      {triage && <TriageSection triage={triage} />}
    </div>
  )
}

/** Eine Nachricht als eigene Box: Meta-Kopf, Inhalt, einklappbares Zitat. */
function MessageBox({
  message,
  meta,
  latest,
  triage
}: {
  message: MessageDetail
  meta: string
  latest: boolean
  triage?: TriageInfo | null
}): React.JSX.Element {
  const t = useT()
  const [showQuote, setShowQuote] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const details = useQuery({
    queryKey: ['messageDetails', message.id],
    queryFn: () => invoke('messages:details', { messageId: message.id }),
    enabled: showDetails,
    staleTime: (query) => (query.state.data?.technicalAvailable ? Infinity : 30_000),
    retry: false
  })
  const parts = message.bodyHtml
    ? splitHtmlQuote(message.bodyHtml)
    : splitTextQuote(message.bodyText ?? '')
  const hasQuote = parts.quoted !== null

  return (
    <div
      className="message-box"
      style={{
        background: latest ? 'var(--sheet)' : 'var(--card-tint)',
        border: `1px solid ${latest ? 'var(--ink)' : 'var(--hairline)'}`,
        boxShadow: latest ? '3px 3px 0 rgba(23,21,15,.08)' : 'none'
      }}
    >
      <button
        type="button"
        className="message-header-toggle"
        data-latest={latest}
        aria-expanded={showDetails}
        aria-controls={`message-details-${message.id}`}
        onClick={() => setShowDetails((open) => !open)}
      >
        <span className="message-header-toggle__summary">{meta}</span>
        <span className="message-header-toggle__action">
          {showDetails ? t('mailDetailsHide') : t('mailDetailsShow')}
          <svg width="10" height="7" viewBox="0 0 10 7" aria-hidden="true">
            <path d="M1 1.5 5 5.5 9 1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </span>
      </button>
      <div id={`message-details-${message.id}`} hidden={!showDetails}>
        {showDetails && (
          <MessageHeaderDetailsPanel
            message={message}
            details={details.data}
            loading={details.isLoading}
            triage={triage}
          />
        )}
      </div>
      <div style={{ padding: '4px 14px 12px' }}>
        <InvitationCards messageId={message.id} />
        <EventSuggestionCards messageId={message.id} />
        {message.bodyHtml ? (
          <InlineMailFrame message={message} html={parts.visible} />
        ) : (
          (parts.visible || '').split('\n\n').map((para, i) => (
            <div
              key={i}
              style={{
                font: '400 14px/1.7 var(--serif)',
                color: 'var(--body-text)',
                marginTop: 10
              }}
            >
              {para}
            </div>
          ))
        )}
        <MessageAttachments
          attachments={message.attachments}
          hasAttachments={message.hasAttachments}
          bodyState={message.bodyState}
        />
        {hasQuote && (
          <div style={{ marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setShowQuote((v) => !v)}
              className="text-btn"
              style={{ borderBottom: '1px solid var(--hairline)' }}
            >
              ↳ {showQuote ? t('quoteHide') : t('quoteShow')}
            </button>
            {showQuote &&
              (message.bodyHtml ? (
                <div style={{ marginTop: 8, opacity: 0.75 }}>
                  <InlineMailFrame message={message} html={parts.quoted!} />
                </div>
              ) : (
                <pre
                  style={{
                    margin: '8px 0 0',
                    whiteSpace: 'pre-wrap',
                    font: '400 12.5px/1.6 var(--serif)',
                    color: 'var(--muted)'
                  }}
                >
                  {parts.quoted}
                </pre>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

export function EmailSheet(): React.JSX.Element {
  const t = useT()
  const lang = useI18n((s) => s.lang)
  const queryClient = useQueryClient()
  const { selThreadKey, filter, comp, setComp, resetComp, toastNow, setSelThreadKey, mbox } =
    usePaper()
  const overrideMenuOpen = useUiStore((s) => s.overrideMenuOpen)
  const setOverrideMenuOpen = useUiStore((s) => s.setOverrideMenuOpen)
  const threads = useThreads(filter, mbox)
  const accounts = useAccounts()
  const beginSend = useSendState((st) => st.begin)

  // Suche/Benachrichtigung können Threads außerhalb der aktuellen Liste öffnen —
  // dann NICHT auf den ersten Listeneintrag zurückfallen (falscher Thread!),
  // sondern den Thread über seine geladenen Nachrichten anzeigen.
  const found = threads.data?.find((th) => th.threadKey === selThreadKey)
  const listItem = found ?? (selThreadKey ? undefined : threads.data?.[0])
  const threadKey = selThreadKey ?? listItem?.threadKey ?? null
  const messages = useThread(threadKey)
  const accountId = listItem?.accountId ?? messages.data?.[0]?.accountId ?? null
  const account = accounts.data?.find((a) => a.id === accountId)
  // Alle eigenen Adressen (mehrere Konten!) — sie fallen bei ALLE aus dem CC.
  const ownEmails = useMemo(() => (accounts.data ?? []).map((a) => a.email), [accounts.data])
  const voiceTag = useVoiceTag(accountId, account?.accountName ?? null)
  const signature = useAccountSignature(account)
  const composerRef = useRef<MailComposerHandle>(null)
  // Extra reply recipients (M90): opened via the + button in the reply-to
  // row; applied on send on top of the computed reply/reply-all set.
  const [extrasOpen, setExtrasOpen] = useState(false)
  const [extraTo, setExtraTo] = useState<string[]>([])
  const [extraCc, setExtraCc] = useState<string[]>([])
  const [extraBcc, setExtraBcc] = useState<string[]>([])
  const extraToText = useRef('')
  const extraCcText = useRef('')
  const extraBccText = useRef('')
  // Gestrichene Antwort-Empfänger (M97): erst damit lässt sich jemand anderem
  // als dem Absender antworten — die berechnete Adresse fliegt raus, die neue
  // kommt über die +Zeile dazu. Wie die Extras threadlokal und flüchtig.
  const [droppedRecipients, setDroppedRecipients] = useState<string[]>([])
  // Getippter, noch nicht als Chip übernommener Empfänger — nur als Ja/Nein,
  // damit die Sendefreigabe stimmt, ohne pro Tastendruck neu zu rendern.
  const [hasPendingExtra, setHasPendingExtra] = useState(false)
  const resetExtras = useCallback((): void => {
    setExtrasOpen(false)
    setExtraTo([])
    setExtraCc([])
    setExtraBcc([])
    setDroppedRecipients([])
    setHasPendingExtra(false)
    extraToText.current = ''
    extraCcText.current = ''
    extraBccText.current = ''
  }, [])
  // Beim Threadwechsel zurücksetzen: State direkt im Render nachziehen
  // (React-Muster „State bei Prop-Änderung anpassen"), Refs im Effect.
  const [extrasThreadKey, setExtrasThreadKey] = useState(threadKey)
  if (extrasThreadKey !== threadKey) {
    setExtrasThreadKey(threadKey)
    setExtrasOpen(false)
    setExtraTo([])
    setExtraCc([])
    setExtraBcc([])
    setDroppedRecipients([])
    setHasPendingExtra(false)
  }
  useEffect(() => {
    extraToText.current = ''
    extraCcText.current = ''
    extraBccText.current = ''
  }, [threadKey])
  const transcriptionOpRef = useRef(0)
  const generationRequestRef = useRef(0)
  const [hasRetryableRecording, setHasRetryableRecording] = useState(false)
  const lastRecordingRef = useRef<{
    blob: Blob
    threadKey: string
    seconds: number
  } | null>(null)
  const { bars, takeRecording } = useListeningAudio(
    comp.mode === 'listening' && comp.threadKey === threadKey
  )
  const savedDrafts = useDrafts()

  // Explizit geöffnete Threads (Klick oder j/k) gelten als gelesen: Marker und
  // fette Zeile verschwinden. Der automatisch angezeigte oberste Thread bleibt
  // ungelesen — sonst würde jeder App-Start die neueste Mail „lesen". Nur
  // wirklich ungelesene Nachrichten anfassen, sonst gingen unnötige
  // setFlags-Ops an den IMAP-Server.
  useEffect(() => {
    if (!selThreadKey || selThreadKey !== threadKey) return
    const unreadIds = (messages.data ?? []).filter((m) => !m.seen).map((m) => m.id)
    if (unreadIds.length === 0) return
    void invoke('messages:action', { messageIds: unreadIds, action: 'markRead' }).then(() => {
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
      void queryClient.invalidateQueries({ queryKey: ['thread', threadKey] })
    })
  }, [selThreadKey, messages.data, threadKey, queryClient])

  // Gespeicherten Entwurf beim Öffnen des Threads in den Composer laden (M37).
  // Ein Live-Puffer eines anderen Threads wird dabei vom Autosave gesichert.
  useEffect(() => {
    if (!threadKey || mbox !== 'inbox') return
    const c = usePaper.getState().comp
    if (c.threadKey === threadKey) return
    if (c.mode !== 'idle' && c.mode !== 'ready') return
    const saved = savedDrafts.data?.find((d) => d.threadKey === threadKey)
    if (!saved) return
    resetComp()
    setComp({ mode: 'ready', threadKey, text: saved.text, html: saved.html, manual: true })
  }, [threadKey, mbox, savedDrafts.data, resetComp, setComp])

  // Uhr während des Zuhörens
  useEffect(() => {
    if (comp.mode !== 'listening') return
    const iv = setInterval(() => {
      const { comp: c, setComp: set } = usePaper.getState()
      set({ secs: c.secs + 1 })
    }, 1000)
    return () => clearInterval(iv)
  }, [comp.mode])

  // Draft-Streaming empfangen
  useEffect(
    () =>
      onPush('ai:draftChunk', (payload) => {
        const { comp: c, setComp: set } = usePaper.getState()
        if (payload.draftId !== c.draftId) return
        if (payload.error) {
          const restoredText = c.originalText
          set({
            mode: restoredText.trim() ? 'ready' : 'idle',
            text: restoredText,
            html: c.originalHtml,
            resultKind: null,
            error: payload.error,
            errorKind: 'generation',
            generationStarted: false,
            draftId: null
          })
          return
        }
        if (payload.chunk) {
          set({
            text: c.generationStarted ? c.text + payload.chunk : payload.chunk,
            html: '',
            mode: 'drafting',
            generationStarted: true
          })
        }
        if (payload.done) {
          const latest = usePaper.getState().comp
          if (!latest.generationStarted) {
            set({
              mode: latest.originalText.trim() ? 'ready' : 'idle',
              text: latest.originalText,
              html: latest.originalHtml,
              resultKind: null,
              error: t('composerGenerationError'),
              errorKind: 'generation',
              draftId: null,
              generationStarted: false
            })
            return
          }
          set({
            mode: 'ready',
            resultKind: 'generated',
            error: null,
            errorKind: null,
            draftId: null,
            generationStarted: false,
            manual: false,
            elaborated: true
          })
          requestAnimationFrame(() => composerRef.current?.focus())
        }
      }),
    [t]
  )

  const startDictation = useCallback((): void => {
    if (!threadKey || usePaper.getState().mbox !== 'inbox') return
    const c = usePaper.getState().comp
    if (
      c.threadKey === threadKey &&
      (c.mode === 'transcribing' || c.mode === 'drafting' || c.mode === 'sending')
    ) {
      return
    }
    const sameThread = c.threadKey === threadKey
    lastRecordingRef.current = null
    setHasRetryableRecording(false)
    setComp({
      mode: 'listening',
      threadKey,
      transcript: '',
      secs: 0,
      processingSeconds: 0,
      text: sameThread ? c.text : '',
      html: sameThread ? c.html : '',
      originalText: '',
      originalHtml: '',
      resultKind: null,
      error: null,
      errorKind: null,
      draftId: null,
      generationStarted: false,
      reviseBase: null
    })
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [threadKey, setComp])

  const processRecording = useCallback(
    (blob: Blob, threadKeyNow: string, seconds: number, operation: number): void => {
      void (async () => {
        const { blobToWavBase64 } = await import('@renderer/lib/wav')
        const audioBase64 = await blobToWavBase64(blob)
        const result = await invoke('ai:transcribe', { audioBase64, format: 'wav' })
        if (transcriptionOpRef.current !== operation) return
        const current = usePaper.getState().comp
        if (current.threadKey !== threadKeyNow) return
        const transcript = result.text.trim()
        if (!transcript) {
          setComp({
            mode: current.text.trim() ? 'ready' : 'idle',
            error: null,
            errorKind: null,
            resultKind: null
          })
          return
        }
        const nextText = appendTranscription(current.text, transcript)
        const nextHtml = current.html.trim()
          ? appendTranscriptionHtml(current.html, transcript)
          : appendTranscriptionHtml('', nextText)
        setComp({
          mode: 'ready',
          text: nextText,
          html: nextHtml,
          transcript,
          processingSeconds: seconds,
          resultKind: 'transcribed',
          error: null,
          errorKind: null,
          manual: true,
          elaborated: false
        })
        requestAnimationFrame(() => composerRef.current?.focus())
      })().catch((err) => {
        if (transcriptionOpRef.current !== operation) return
        const current = usePaper.getState().comp
        if (current.threadKey !== threadKeyNow) return
        setComp({
          mode: current.text.trim() ? 'ready' : 'idle',
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'transcription',
          resultKind: null
        })
      })
    },
    [setComp]
  )

  const finishListening = useCallback((): void => {
    const c = usePaper.getState().comp
    if (c.mode !== 'listening' || !c.threadKey) return
    const threadKeyNow = c.threadKey
    const seconds = Math.max(1, c.secs)
    const operation = ++transcriptionOpRef.current
    setComp({
      mode: 'transcribing',
      processingSeconds: seconds,
      originalText: c.text,
      originalHtml: c.html,
      resultKind: null,
      error: null,
      errorKind: null
    })
    void takeRecording()
      .then((blob) => {
        if (transcriptionOpRef.current !== operation) return
        if (!blob) {
          const current = usePaper.getState().comp
          setComp({
            mode: current.text.trim() ? 'ready' : 'idle',
            error: t('composerNoRecording'),
            errorKind: null
          })
          return
        }
        lastRecordingRef.current = { blob, threadKey: threadKeyNow, seconds }
        setHasRetryableRecording(true)
        processRecording(blob, threadKeyNow, seconds, operation)
      })
      .catch((err) => {
        if (transcriptionOpRef.current !== operation) return
        const current = usePaper.getState().comp
        setComp({
          mode: current.text.trim() ? 'ready' : 'idle',
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'transcription'
        })
      })
  }, [processRecording, setComp, t, takeRecording])

  const retryTranscription = useCallback((): void => {
    const recording = lastRecordingRef.current
    if (!recording || recording.threadKey !== threadKey) return
    const c = usePaper.getState().comp
    const operation = ++transcriptionOpRef.current
    setComp({
      mode: 'transcribing',
      processingSeconds: recording.seconds,
      originalText: c.text,
      originalHtml: c.html,
      error: null,
      errorKind: null,
      resultKind: null
    })
    processRecording(recording.blob, recording.threadKey, recording.seconds, operation)
  }, [processRecording, setComp, threadKey])

  // Der Inhalt des gemeinsamen Editors ist zugleich Nachricht, Diktat-Ziel
  // und Ausgangspunkt für eine Formulierung durch die Eule.
  const elaborate = useCallback((): void => {
    const c = usePaper.getState().comp
    if (
      usePaper.getState().mbox !== 'inbox' ||
      !c.threadKey ||
      c.threadKey !== threadKey ||
      c.mode === 'listening' ||
      c.mode === 'transcribing' ||
      c.mode === 'drafting' ||
      c.mode === 'sending'
    ) {
      return
    }
    const idea = c.text.trim()
    if (!idea) return
    const request = ++generationRequestRef.current
    setComp({
      mode: 'drafting',
      originalText: c.text,
      originalHtml: c.html,
      resultKind: null,
      error: null,
      errorKind: null,
      draftId: null,
      generationStarted: false,
      manual: false,
      elaborated: true,
      editing: false
    })
    void invoke('ai:draftReply', { threadKey: c.threadKey, idea })
      .then(({ draftId }) => {
        if (generationRequestRef.current !== request) return
        const current = usePaper.getState().comp
        if (current.threadKey === c.threadKey && current.mode === 'drafting') {
          setComp({ draftId })
        }
      })
      .catch((err) => {
        if (generationRequestRef.current !== request) return
        setComp({
          mode: 'ready',
          text: c.text,
          html: c.html,
          resultKind: null,
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'generation',
          generationStarted: false,
          draftId: null,
          manual: true,
          elaborated: false
        })
      })
  }, [setComp, threadKey])

  const redraft = useCallback((): void => {
    elaborate()
  }, [elaborate])

  const manualReply = useCallback((): void => {
    if (!threadKey || usePaper.getState().mbox !== 'inbox') return
    const c = usePaper.getState().comp
    if (c.threadKey !== threadKey) {
      resetComp()
      setComp({ threadKey, replyAll: false })
    } else if (c.replyAll) {
      // r schaltet eine offene Allen-Antwort zurück auf den Absender
      setComp({ replyAll: false })
    }
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [threadKey, resetComp, setComp])

  // Allen antworten (M80): wie r, aber mit CC an die übrigen ursprünglichen
  // Empfänger. Ohne weitere Empfänger bleibt es eine normale Antwort + Hinweis.
  const replyAllReply = useCallback((): void => {
    if (!threadKey || usePaper.getState().mbox !== 'inbox') return
    const all = messages.data ? buildReplyRecipients(messages.data, ownEmails, 'all') : null
    if (!all || all.cc.length === 0) {
      toastNow(t('toastReplyAllAlone'))
      manualReply()
      return
    }
    const c = usePaper.getState().comp
    if (c.threadKey !== threadKey) {
      resetComp()
      setComp({ threadKey, replyAll: true })
    } else if (!c.replyAll) {
      setComp({ replyAll: true })
    }
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [threadKey, messages.data, ownEmails, toastNow, t, manualReply, resetComp, setComp])

  const sendDraft = useCallback((): void => {
    const c = usePaper.getState().comp
    if (
      usePaper.getState().mbox !== 'inbox' ||
      !c.threadKey ||
      c.threadKey !== threadKey ||
      !c.text.trim() ||
      c.mode === 'listening' ||
      c.mode === 'transcribing' ||
      c.mode === 'drafting' ||
      c.mode === 'sending' ||
      !messages.data ||
      !account
    ) {
      return
    }
    const reply = buildReplyRecipients(messages.data, ownEmails, c.replyAll ? 'all' : 'sender')
    if (!reply) return
    // Merge the extra recipients in, keeping each address in one field only
    // (to beats cc beats bcc) and never duplicating an address.
    const { to, cc, bcc } = mergeRecipientFields({
      to: [
        ...dropRecipients(reply.to, droppedRecipients),
        ...extraTo,
        ...parseAddresses(extraToText.current)
      ],
      cc: [
        ...dropRecipients(reply.cc, droppedRecipients),
        ...extraCc,
        ...parseAddresses(extraCcText.current)
      ],
      bcc: [...extraBcc, ...parseAddresses(extraBccText.current)]
    })
    // Alles gestrichen und nichts nachgetragen: lieber nicht senden als an
    // niemanden — der Sendeknopf ist dann ohnehin gesperrt.
    if (to.length + cc.length + bcc.length === 0) return
    const htmlBody = composerHtmlForSend(c.html, c.text)
    setComp({ mode: 'sending', error: null, errorKind: null })
    void invoke('compose:send', {
      accountId: account.id,
      to,
      cc,
      bcc,
      subject: reply.subject,
      textBody: c.text,
      htmlBody,
      replyToMessageId: reply.replyToMessageId
    })
      .then(({ outboxId, sendAt }) => {
        // Nicht sofort archivieren: der Thread wird nur versteckt und erst
        // archiviert, wenn der Versand wirklich draußen ist — Rückgängig holt
        // ihn samt Entwurf zurück (Staging lebt im send-Store).
        beginSend({
          outboxId,
          sendAt,
          accountId: account.id,
          fromAddr: account.email,
          subject: reply.subject,
          to,
          archive: c.threadKey
            ? { threadKey: c.threadKey, messageIds: messages.data!.map((m) => m.id) }
            : undefined
        })
        usePaper.getState().resetComp()
        resetExtras()
      })
      .catch((err) => {
        const current = usePaper.getState().comp
        if (current.threadKey !== c.threadKey) return
        setComp({
          mode: 'ready',
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'send'
        })
      })
  }, [
    messages.data,
    account,
    ownEmails,
    beginSend,
    setComp,
    threadKey,
    extraTo,
    extraCc,
    extraBcc,
    droppedRecipients,
    resetExtras
  ])

  const updateDocument = useCallback(
    (document: ComposerDocument): void => {
      if (!threadKey) return
      const c = usePaper.getState().comp
      if (c.threadKey !== threadKey) {
        resetComp()
        setComp({
          mode: document.text.trim() ? 'ready' : 'idle',
          threadKey,
          text: document.text,
          html: document.html,
          manual: true
        })
        return
      }
      setComp({
        mode: c.mode === 'listening' ? 'listening' : document.text.trim() ? 'ready' : 'idle',
        text: document.text,
        html: document.html,
        error: null,
        errorKind: null,
        manual: true
      })
    },
    [resetComp, setComp, threadKey]
  )

  const restoreOriginal = useCallback((): void => {
    const c = usePaper.getState().comp
    if (c.threadKey !== threadKey || !c.resultKind) return
    setComp({
      mode: c.originalText.trim() ? 'ready' : 'idle',
      text: c.originalText,
      html: c.originalHtml,
      originalText: '',
      originalHtml: '',
      resultKind: null,
      error: null,
      errorKind: null,
      manual: true,
      elaborated: false
    })
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [setComp, threadKey])

  const cancelTransient = useCallback((): void => {
    const c = usePaper.getState().comp
    if (c.threadKey !== threadKey || c.mode === 'sending') return
    transcriptionOpRef.current += 1
    generationRequestRef.current += 1
    if (c.mode === 'listening') void takeRecording()
    if (c.mode === 'drafting') {
      setComp({
        mode: c.originalText.trim() ? 'ready' : 'idle',
        text: c.originalText,
        html: c.originalHtml,
        resultKind: null,
        error: null,
        errorKind: null,
        draftId: null,
        generationStarted: false
      })
    } else if (c.mode === 'listening' || c.mode === 'transcribing') {
      setComp({
        mode: c.text.trim() ? 'ready' : 'idle',
        error: null,
        errorKind: null,
        draftId: null
      })
    }
  }, [setComp, takeRecording, threadKey])

  const discardDraft = useCallback((): void => {
    if (usePaper.getState().comp.threadKey !== threadKey) return
    transcriptionOpRef.current += 1
    generationRequestRef.current += 1
    setHasRetryableRecording(false)
    resetComp()
    if (threadKey) removeDraft(threadKey)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [resetComp, threadKey])

  const dismissError = useCallback((): void => {
    if (usePaper.getState().comp.threadKey === threadKey) {
      setComp({ error: null, errorKind: null })
    }
  }, [setComp, threadKey])

  const retryError = useCallback((): void => {
    const c = usePaper.getState().comp
    if (c.threadKey !== threadKey) return
    if (c.errorKind === 'transcription') retryTranscription()
    else if (c.errorKind === 'generation') elaborate()
    else if (c.errorKind === 'send') sendDraft()
  }, [elaborate, retryTranscription, sendDraft, threadKey])

  const decideTask = useCallback(
    (accept: boolean): void => {
      if (
        usePaper.getState().mbox !== 'inbox' ||
        !threadKey ||
        !listItem?.suggestedTask ||
        listItem.taskState !== 'suggested'
      ) {
        return
      }
      void invoke('tasks:decideSuggestion', { threadKey, accept }).then(() => {
        void queryClient.invalidateQueries({ queryKey: ['threads'] })
        void queryClient.invalidateQueries({ queryKey: ['tasks'] })
        toastNow(
          accept
            ? t('toastTaskAdded', { label: listItem.suggestedTask!.label })
            : t('toastTaskDismissed')
        )
      })
    },
    [threadKey, listItem, queryClient, toastNow, t]
  )

  // Rückgängig fürs Ablegen: Knopf im Toast und Taste z laufen beide hierher.
  const archiveToastRef = useRef<number | null>(null)
  const undoArchive = useCallback((): void => {
    if (usePaper.getState().undoArchive()) {
      if (archiveToastRef.current !== null) toast.dismiss(archiveToastRef.current)
      archiveToastRef.current = null
      toastNow(t('toastBackInbox'))
    } else toastNow(t('toastNothingUndo'))
  }, [toastNow, t])

  // Ablegen mit Undo-Fenster: erst optisch verstecken, nach 5s wirklich
  // archivieren (Archive löscht die Rows lokal — danach gäbe es kein Zurück).
  const archive = useCallback((): void => {
    if (!threadKey || !messages.data || usePaper.getState().mbox !== 'inbox') return
    const rows = (threads.data ?? []).filter(
      (r) => !usePaper.getState().hiddenThreads.has(r.threadKey)
    )
    const i = rows.findIndex((r) => r.threadKey === threadKey)
    const next = rows[i + 1] ?? rows[i - 1] ?? null
    usePaper.getState().stageArchive(
      threadKey,
      messages.data.map((m) => m.id)
    )
    setSelThreadKey(next && next.threadKey !== threadKey ? next.threadKey : null)
    if (usePaper.getState().comp.threadKey === threadKey) resetComp()
    // Action-Toast lebt exakt so lange wie das Undo-Fenster von stageArchive
    archiveToastRef.current = toast.action(
      t('toastFiled'),
      { label: t('toastUndo'), kbd: 'Z', run: undoArchive },
      ARCHIVE_UNDO_WINDOW_MS
    )
  }, [threadKey, messages.data, threads.data, setSelThreadKey, resetComp, undoArchive, t])

  const notSpam = useCallback((): void => {
    if (!threadKey || !messages.data) return
    void invoke('messages:action', {
      messageIds: messages.data.map((m) => m.id),
      action: 'notSpam'
    }).then(() => {
      setSelThreadKey(null)
      toastNow(t('toastBackInbox'))
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
      void queryClient.invalidateQueries({ queryKey: ['mboxCounts'] })
    })
  }, [threadKey, messages.data, setSelThreadKey, toastNow, t, queryClient])

  // Keymap-Aktionen (Custom-Events aus keymap.ts)
  useEffect(() => {
    const onAction = (e: Event): void => {
      const action = (e as CustomEvent<string>).detail
      const c = usePaper.getState().comp
      if (action === 'dictate') c.mode === 'listening' ? finishListening() : startDictation()
      else if (action === 'enter') {
        if (c.mode === 'listening') finishListening()
        else sendDraft()
      } else if (action === 'file') {
        archive()
      } else if (action === 'reply') manualReply()
      else if (action === 'replyAll') replyAllReply()
      else if (action === 'redraft') redraft()
      else if (action === 'elaborate') elaborate()
      else if (action === 'summarize') {
        if (listItem?.aiSummary)
          toast.info(t('toastOwlGist', { gist: listItem.aiSummary }), { owl: true })
        else toastNow(t('toastNoQuestion'))
      } else if (action === 'undo') undoArchive()
      else if (action === 'taskAccept') decideTask(true)
      else if (action === 'taskDismiss') decideTask(false)
      else if (action === 'override') {
        // Taste l (Design 3d): Kategorie-Menü nur öffnen, wenn ein Thread da ist
        if (listItem) setOverrideMenuOpen(true)
      } else if (action === 'escape') {
        if (c.mode === 'listening' || c.mode === 'transcribing' || c.mode === 'drafting') {
          cancelTransient()
        }
      }
    }
    window.addEventListener('paper:mail', onAction)
    return () => window.removeEventListener('paper:mail', onAction)
  }, [
    finishListening,
    startDictation,
    sendDraft,
    archive,
    manualReply,
    replyAllReply,
    redraft,
    elaborate,
    undoArchive,
    decideTask,
    cancelTransient,
    listItem,
    setOverrideMenuOpen,
    toastNow,
    t
  ])

  // Override-Menü schließen, wenn der Thread verschwindet oder die Ansicht
  // wechselt — ein hängender Open-Zustand würde die Einzeltasten blockieren.
  useEffect(() => {
    if (overrideMenuOpen && !listItem) setOverrideMenuOpen(false)
  }, [overrideMenuOpen, listItem, setOverrideMenuOpen])
  useEffect(() => () => useUiStore.getState().setOverrideMenuOpen(false), [])

  const lastMsg = messages.data?.[messages.data.length - 1]
  if (!listItem && !lastMsg) {
    return <SheetEmpty line={t('inboxZero')} sub={t('inboxZeroSub')} />
  }

  const meta = (m: MessageDetail): string => {
    // Bei selbst gesendeten Nachrichten den echten Empfänger zeigen, nicht das eigene Konto
    const sentBySelf = (m.fromAddr ?? '').toLowerCase() === (account?.email ?? '').toLowerCase()
    const recipients = [...m.to, ...m.cc]
    const firstRecipient = recipients[0]
    const destination = sentBySelf
      ? (firstRecipient?.name ?? firstRecipient?.address ?? '?')
      : (firstRecipient?.name ?? firstRecipient?.address ?? account?.email ?? '?')
    const more = recipients.length > 1 ? ` +${recipients.length - 1}` : ''
    return `${m.fromName ?? m.fromAddr ?? '?'} ‹${m.fromAddr ?? '?'}› → ${destination}${more} · ${rowTime(lang, m.date)}`.toUpperCase()
  }

  const newestFirst = [...(messages.data ?? [])].reverse()
  const compHere = comp.threadKey === threadKey
  const composerDocument: ComposerDocument = compHere
    ? { text: comp.text, html: comp.html }
    : { text: '', html: '' }
  const composerActivity: ComposerActivity = !compHere
    ? 'idle'
    : comp.mode === 'drafting'
      ? 'generating'
      : comp.mode === 'ready'
        ? 'idle'
        : comp.mode
  const isReplyAll = compHere && comp.replyAll
  const replyTarget =
    account && messages.data
      ? buildReplyRecipients(messages.data, ownEmails, isReplyAll ? 'all' : 'sender')
      : null
  // Gibt es überhaupt weitere Empfänger? Steuert den Umschalter in der Zeile.
  const replyAllExtras =
    account && messages.data
      ? (buildReplyRecipients(messages.data, ownEmails, 'all')?.cc ?? [])
      : []
  // Was nach dem Streichen (M97) übrig bleibt. Anzeige, Sendefreigabe und
  // Versand lesen denselben Stand, damit die Zeile nicht lügt.
  const replyToLive = replyTarget ? dropRecipients(replyTarget.to, droppedRecipients) : []
  const replyCcLive = replyTarget ? dropRecipients(replyTarget.cc, droppedRecipients) : []
  const extraCount = extraTo.length + extraCc.length + extraBcc.length
  const hasRecipient = replyToLive.length + replyCcLive.length + extraCount > 0 || hasPendingExtra
  const canRetryError =
    comp.errorKind === 'generation' ||
    comp.errorKind === 'send' ||
    (comp.errorKind === 'transcription' && hasRetryableRecording)
  const composerError =
    compHere && comp.error
      ? {
          message: comp.error,
          ...(canRetryError ? { onRetry: retryError } : {}),
          onDismiss: dismissError
        }
      : null

  return (
    <div className="sheet-card min-w-0 flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div style={{ font: '500 21px var(--serif)' }}>
        {listItem?.subject ?? lastMsg?.subject ?? '—'}
      </div>

      {newestFirst.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <MessageBox
            key={newestFirst[0].id}
            message={newestFirst[0]}
            meta={meta(newestFirst[0])}
            latest
          />
        </div>
      )}

      {listItem?.suggestedTask && listItem.taskState === 'suggested' && (
        <div
          className="ink-card flex items-center gap-2.5"
          style={{ padding: '8px 12px', marginTop: 18 }}
        >
          <span className="mlabel flex-none" style={{ fontSize: 8, color: 'var(--muted)' }}>
            {t('owlFoundTask')}
          </span>
          <span className="min-w-0 flex-1 truncate" style={{ font: '400 13px var(--serif)' }}>
            ☐ {listItem.suggestedTask.label}
          </span>
          {listItem.suggestedTask.due && (
            <span
              className="mchip flex-none"
              style={{ color: 'var(--paper)', background: 'var(--ac)', padding: '1px 6px' }}
            >
              {listItem.suggestedTask.due.toUpperCase()}
            </span>
          )}
          <button
            type="button"
            onClick={() => decideTask(true)}
            className="btn-bare flex-none"
            style={{
              font: '500 9px var(--mono)',
              color: 'var(--paper)',
              background: 'var(--ink)',
              padding: '2px 8px'
            }}
          >
            {t('tAdd')}
          </button>
          <button
            type="button"
            onClick={() => decideTask(false)}
            className="btn-bare hit-target flex-none"
            aria-label={t('toastTaskDismissed')}
            style={{ font: '500 9px var(--mono)', color: 'var(--muted)' }}
          >
            X
          </button>
        </div>
      )}
      {listItem?.suggestedTask && listItem.taskState === 'accepted' && (
        <div
          className="flex items-center gap-2.5"
          style={{ border: '1px solid var(--hairline)', padding: '8px 12px', marginTop: 18 }}
        >
          <span className="mlabel flex-none" style={{ fontSize: 8, color: 'var(--ac)' }}>
            {t('inYourTasks')}
          </span>
          <span
            className="min-w-0 flex-1 truncate"
            style={{ font: '400 13px var(--serif)', color: 'var(--secondary)' }}
          >
            {listItem.suggestedTask.label}
          </span>
          {listItem.suggestedTask.due && (
            <span
              className="mchip flex-none"
              style={{
                color: 'var(--muted)',
                border: '1px solid var(--hairline)',
                padding: '0 6px'
              }}
            >
              {listItem.suggestedTask.due.toUpperCase()}
            </span>
          )}
        </div>
      )}

      <div className="double-rule" style={{ marginTop: 18 }} />

      {mbox !== 'inbox' && (
        <div
          className="flex items-center gap-3"
          style={{ marginTop: 16, padding: '10px 12px', border: '1px dashed var(--hairline)' }}
        >
          <span className="mlabel flex-none" style={{ fontSize: 8, color: 'var(--muted)' }}>
            {mbox === 'spam' ? t('mboxSpam') : t('mboxSent')}
          </span>
          <span
            className="flex-1"
            style={{
              font: '400 13px var(--serif)',
              fontStyle: 'italic',
              color: 'var(--secondary)'
            }}
          >
            {mbox === 'spam' ? t('mboxSpamNote') : t('mboxSentNote')}
          </span>
          {mbox === 'spam' && (
            <button
              type="button"
              onClick={notSpam}
              className="btn-bare flex-none"
              style={{
                font: '500 9px var(--mono)',
                color: 'var(--paper)',
                background: 'var(--ink)',
                padding: '4px 10px'
              }}
            >
              {t('notSpamBtn')}
            </button>
          )}
        </div>
      )}

      {mbox === 'inbox' && (
        <div style={{ marginTop: 16 }}>
          {replyTarget && (
            <div style={{ margin: '0 2px 6px' }}>
              <div className="flex items-center gap-2.5" style={{ minWidth: 0 }}>
                <span className="mlabel flex-none" style={{ fontSize: 8, color: 'var(--muted)' }}>
                  {t('replyScopeLabel')}
                </span>
                <span className="reply-chips min-w-0 flex-1">
                  {replyToLive.length === 0 ? (
                    <span className="reply-chips__empty">{t('replyNoRecipient')}</span>
                  ) : (
                    replyToLive.map((address) => (
                      <span key={address} className="reply-chip" title={address}>
                        <span className="reply-chip__addr">{address}</span>
                        <button
                          type="button"
                          className="reply-chip__drop"
                          onClick={() => setDroppedRecipients((prev) => [...prev, address])}
                          aria-label={t('replyDropRecipient', { addr: address })}
                          title={t('replyDropRecipient', { addr: address })}
                        >
                          ×
                        </button>
                      </span>
                    ))
                  )}
                </span>
                {droppedRecipients.length > 0 && (
                  <button
                    type="button"
                    className="reply-extra-btn flex-none"
                    onClick={() => setDroppedRecipients([])}
                    aria-label={t('replyRestoreRecipients')}
                    title={t('replyRestoreRecipients')}
                  >
                    ↺
                  </button>
                )}
                {replyAllExtras.length > 0 && (
                  <button
                    type="button"
                    className="reply-scope-toggle flex-none"
                    onClick={isReplyAll ? manualReply : replyAllReply}
                    aria-pressed={isReplyAll}
                    aria-label={t('replyAllToggleAria', { n: replyAllExtras.length })}
                    title="⌘⇧A"
                  >
                    <span className="reply-scope-toggle__label">
                      {t('replyAllToggle')}{' '}
                      <span className="reply-scope-toggle__count">
                        {t('replyAllPlus', { n: replyAllExtras.length })}
                      </span>
                    </span>
                    <span className="reply-scope-toggle__track" aria-hidden="true">
                      <span className="reply-scope-toggle__knob" />
                    </span>
                    <span className="reply-scope-toggle__kbd" aria-hidden="true">
                      ⌘⇧A
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  className="reply-extra-btn flex-none"
                  onClick={() => setExtrasOpen((open) => !open)}
                  aria-expanded={extrasOpen}
                  data-open={extrasOpen}
                  data-active={extraTo.length + extraCc.length + extraBcc.length > 0}
                  aria-label={t('replyExtraAria')}
                  title={t('replyExtraAria')}
                >
                  {extraTo.length + extraCc.length + extraBcc.length > 0
                    ? t('replyAllPlus', { n: extraTo.length + extraCc.length + extraBcc.length })
                    : '+'}
                </button>
              </div>
              {isReplyAll && replyCcLive.length > 0 && (
                <div className="flex items-baseline gap-2.5" style={{ marginTop: 5, minWidth: 0 }}>
                  <span className="mlabel flex-none" style={{ fontSize: 9, color: 'var(--ac)' }}>
                    CC
                  </span>
                  <span className="reply-chips min-w-0 flex-1">
                    {replyCcLive.map((address) => (
                      <span key={address} className="reply-chip" title={address}>
                        <span className="reply-chip__addr">{address}</span>
                        <button
                          type="button"
                          className="reply-chip__drop"
                          onClick={() => setDroppedRecipients((prev) => [...prev, address])}
                          aria-label={t('replyDropRecipient', { addr: address })}
                          title={t('replyDropRecipient', { addr: address })}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </span>
                </div>
              )}
              {extrasOpen && (
                <div style={{ marginTop: 6 }}>
                  {(
                    [
                      {
                        label: t('replyExtraTo'),
                        chips: extraTo,
                        set: setExtraTo,
                        ref: extraToText
                      },
                      { label: t('composeCc'), chips: extraCc, set: setExtraCc, ref: extraCcText },
                      {
                        label: t('composeBcc'),
                        chips: extraBcc,
                        set: setExtraBcc,
                        ref: extraBccText
                      }
                    ] as const
                  ).map((field, index) => (
                    <div
                      key={field.label}
                      className="flex items-start gap-2.5"
                      style={{ padding: '4px 0', minWidth: 0 }}
                    >
                      <span
                        className="mlabel flex-none"
                        style={{ fontSize: 8, color: 'var(--muted)', width: 34, marginTop: 7 }}
                      >
                        {field.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <RecipientInput
                          label=""
                          chips={field.chips as string[]}
                          onChipsChange={field.set}
                          onTextChange={(text) => {
                            field.ref.current = text
                            // Noch nicht als Chip übernommener Text zählt für
                            // die Sendefreigabe mit — sonst schluckt der
                            // gesperrte Knopf den ersten Klick, wenn man den
                            // Absender gestrichen und die neue Adresse gerade
                            // erst getippt hat. setState mit gleichem Wert
                            // rendert nicht neu, das bleibt pro Tastendruck
                            // billig.
                            setHasPendingExtra(
                              Boolean(
                                extraToText.current.trim() ||
                                extraCcText.current.trim() ||
                                extraBccText.current.trim()
                              )
                            )
                          }}
                          autoFocus={index === 0}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          <MailComposerSurface
            ref={composerRef}
            variant="reply"
            document={composerDocument}
            activity={composerActivity}
            recordingSeconds={compHere ? comp.secs : 0}
            processingSeconds={compHere ? comp.processingSeconds : 0}
            audioBars={bars}
            placeholder={t('composerReplyPlaceholder')}
            voiceTag={voiceTag}
            signatureConfig={signature.config}
            signatureText={signature.text}
            resultKind={compHere ? comp.resultKind : null}
            error={composerError}
            canSend={Boolean(
              compHere && comp.text.trim() && account && replyTarget && hasRecipient
            )}
            onDocumentChange={updateDocument}
            onStartDictation={startDictation}
            onStopDictation={finishListening}
            onCancelTransient={cancelTransient}
            onGenerate={elaborate}
            onSend={sendDraft}
            onRestoreOriginal={compHere && comp.resultKind ? restoreOriginal : undefined}
            onDiscard={compHere && comp.text.trim() ? discardDraft : undefined}
            onErrorMessage={toastNow}
            sendRecipientCount={
              isReplyAll && replyTarget ? replyToLive.length + replyCcLive.length : null
            }
            onToggleReplyScope={
              replyAllExtras.length > 0 ? (isReplyAll ? manualReply : replyAllReply) : undefined
            }
          />
        </div>
      )}

      {newestFirst.slice(1).map((m, i) => (
        <div key={m.id}>
          <ReplyArrow gapLabel={formatGap(lang, (newestFirst[i].date ?? 0) - (m.date ?? 0))} />
          <MessageBox message={m} meta={meta(m)} latest={false} />
        </div>
      ))}

      {overrideMenuOpen && listItem && <OverrideMenu thread={listItem} />}
    </div>
  )
}
