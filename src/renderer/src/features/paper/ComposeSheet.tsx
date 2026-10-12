import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { invoke, onPush } from '@renderer/lib/ipc'
import { useAccounts } from '@renderer/queries/accounts'
import { usePaper } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import { useSendState } from '@renderer/stores/send'
import { useVoiceTag } from '@renderer/features/paper/useVoiceTag'
import { RecipientInput } from '@renderer/features/composer/RecipientInput'
import {
  MailComposerSurface,
  type ComposerError,
  type ComposerResultKind,
  type MailComposerHandle
} from '@renderer/features/composer/MailComposerSurface'
import { composerHtmlForSend } from '@renderer/features/composer/composer-html'
import {
  appendTranscription,
  appendTranscriptionHtml,
  type ComposerActivity
} from '@renderer/features/composer/composer-state'
import { useAccountSignature } from '@renderer/features/composer/useAccountSignature'
import { FromAccountPicker } from '@renderer/features/composer/FromAccountPicker'
import { FROM_AUTOPILOT_NOTE_MS, planAutoSwitch } from '@renderer/features/composer/from-autopilot'
import { classifyAddress, parseAddresses } from '@renderer/features/composer/address-check'
import { useListeningAudio } from '@renderer/features/paper/useListeningAudio'
import {
  isComposeDraftEmpty,
  loadComposeDraft,
  saveComposeDraft,
  type ComposeDraft
} from '@renderer/lib/composeDraft'

type ComposeMode = 'idle' | 'listening' | 'transcribing' | 'drafting'
type CompositionMode = 'dictation' | 'idea'
type FailureKind = 'transcription' | 'generation' | 'send'

interface CompositionResult {
  originalBody: string
  originalSubject: string
  originalHtml: string
  resultKind: ComposerResultKind | null
}

interface ComposerFailure {
  kind: FailureKind
  message: string
  retryable: boolean
}

/**
 * The new-message screen and the reply field use the same composer
 * surface. Recipients, sender choice and subject remain here as adapters.
 */
export function ComposeSheet(): React.JSX.Element {
  const t = useT()
  const accounts = useAccounts()
  const beginSend = useSendState((state) => state.begin)
  const { toastNow, setView } = usePaper()

  const [fromId, setFromId] = useState<number | null>(null)
  const [to, setTo] = useState<string[]>([])
  const [toText, setToText] = useState('')
  const [cc, setCc] = useState<string[]>([])
  const [ccText, setCcText] = useState('')
  const [bcc, setBcc] = useState<string[]>([])
  const [bccText, setBccText] = useState('')
  const [showCc, setShowCc] = useState(false)
  const [showBcc, setShowBcc] = useState(false)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [mode, setMode] = useState<ComposeMode>('idle')
  const [listeningSeconds, setListeningSeconds] = useState(0)
  const [processingSeconds, setProcessingSeconds] = useState(0)
  const [compositionResult, setCompositionResult] = useState<CompositionResult | null>(null)
  const [failure, setFailure] = useState<ComposerFailure | null>(null)
  const [sending, setSending] = useState(false)
  // Accent note when the account autopilot switched the FROM account (Design 3a)
  const [autoNote, setAutoNote] = useState<{ name: string; addr: string } | null>(null)

  const surfaceRef = useRef<MailComposerHandle>(null)
  const draftIdRef = useRef<string | null>(null)
  const generationRequestRef = useRef(0)
  const generationStartedRef = useRef(false)
  const transcriptionOperationRef = useRef(0)
  const lastRecordingRef = useRef<{ blob: Blob; seconds: number } | null>(null)
  const activeOriginalRef = useRef<{
    body: string
    subject: string
    html: string
  } | null>(null)
  const bodyValueRef = useRef('')
  const bodyHtmlRef = useRef('')
  const fromManuallySelectedRef = useRef(false)
  const replyToRef = useRef<number | null>(null)
  const draftLoadedRef = useRef(false)
  const skipDraftSaveRef = useRef(false)
  const draftRef = useRef<ComposeDraft | null>(null)

  const { bars, takeRecording } = useListeningAudio(mode === 'listening')

  const replaceBody = useCallback((text: string, html = ''): void => {
    bodyValueRef.current = text
    bodyHtmlRef.current = html
    setBody(text)
    setBodyHtml(html)
  }, [])

  useEffect(() => {
    if (mode !== 'listening') return
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setListeningSeconds(Math.floor((Date.now() - startedAt) / 1000))
    }, 250)
    return () => clearInterval(timer)
  }, [mode])

  const accs = accounts.data ?? []
  const account = accs.find((candidate) => candidate.id === fromId) ?? accs[0]
  const voiceTag = useVoiceTag(account?.id ?? null, account?.accountName ?? null)
  const signature = useAccountSignature(account)

  // Mirror the effective account for the autopilot — the lookup is async
  // and must not compare against a stale state
  const effectiveAccountIdRef = useRef<number | null>(null)
  useEffect(() => {
    effectiveAccountIdRef.current = account?.id ?? null
  })

  const toList = useMemo(() => [...to, ...parseAddresses(toText)], [to, toText])
  const canSend = Boolean(account && toList.length > 0 && body.trim() && !sending)

  // Carry the current state as a draft — for debounced saving and the unmount flush
  useEffect(() => {
    draftRef.current = {
      accountId: account?.id ?? null,
      to: [...new Set(toList)],
      cc: [...new Set([...cc, ...parseAddresses(ccText)])],
      bcc: [...new Set([...bcc, ...parseAddresses(bccText)])],
      subject,
      body,
      html: bodyHtml,
      replyToMessageId: replyToRef.current ?? undefined
    }
  })

  // Restore a saved draft (e.g. after clicking a mail or undo)
  useEffect(() => {
    void loadComposeDraft()
      .then((draft) => {
        if (!draft) return
        if (draft.accountId !== null) {
          // Keep the draft's account — don't let the recipient autopilot override it
          fromManuallySelectedRef.current = true
          setFromId(draft.accountId)
        }
        setTo(draft.to)
        setCc(draft.cc)
        setBcc(draft.bcc)
        setSubject(draft.subject)
        if (draft.body.trim()) replaceBody(draft.body, draft.html)
        replyToRef.current = draft.replyToMessageId ?? null
        toastNow(t('composeDraftRestored'))
      })
      .finally(() => {
        draftLoadedRef.current = true
      })
  }, [replaceBody, toastNow, t])

  // Save the draft continuously (debounced) — send/discard delete it explicitly
  useEffect(() => {
    if (!draftLoadedRef.current || skipDraftSaveRef.current) return
    const timer = setTimeout(() => {
      if (skipDraftSaveRef.current) return
      const draft = draftRef.current
      if (draft) void saveComposeDraft(isComposeDraftEmpty(draft) ? null : draft)
    }, 800)
    return () => clearTimeout(timer)
  }, [to, toText, cc, ccText, bcc, bccText, subject, body, bodyHtml, fromId])

  // On closing the composer (mail click, Esc, view switch) save immediately
  useEffect(
    () => () => {
      if (skipDraftSaveRef.current || !draftLoadedRef.current) return
      const draft = draftRef.current
      if (draft) void saveComposeDraft(isComposeDraftEmpty(draft) ? null : draft)
    },
    []
  )

  const switchAccount = (id: number): void => {
    fromManuallySelectedRef.current = true
    setFromId(id)
    // Manual choice wins — and suppresses the autopilot note (Design 3a)
    setAutoNote(null)
  }

  // New messages follow the mailbox last used for the first recipient.
  // If the automation switches the visible account, it briefly announces it;
  // a manual selection takes precedence for this draft.
  useEffect(() => {
    // Only query plausible addresses — dubious chips (jonas@web) have
    // no history and would fail the IPC email validation
    const recipient = [...to, ...parseAddresses(toText)].find(
      (address) => classifyAddress(address) === 'ok'
    )
    if (!recipient || fromManuallySelectedRef.current) return
    let canceled = false
    void invoke('contacts:preferredAccount', { addr: recipient })
      .then(({ accountId }) => {
        if (canceled) return
        const plan = planAutoSwitch({
          preferredAccountId: accountId,
          currentAccountId: effectiveAccountIdRef.current,
          manuallySelected: fromManuallySelectedRef.current,
          accountIds: (accounts.data ?? []).map((candidate) => candidate.id)
        })
        if (!plan) return
        setFromId(plan.accountId)
        if (plan.showNote) {
          const target = accounts.data?.find((candidate) => candidate.id === plan.accountId)
          if (target) setAutoNote({ name: target.accountName, addr: recipient })
        }
      })
      .catch(() => {})
    return () => {
      canceled = true
    }
  }, [to, toText, accounts.data])

  // Hide the autopilot note again after ~4 s
  useEffect(() => {
    if (!autoNote) return
    const timer = setTimeout(() => setAutoNote(null), FROM_AUTOPILOT_NOTE_MS)
    return () => clearTimeout(timer)
  }, [autoNote])

  // Esc files the draft away and returns to the inbox (Design 3a).
  // It is saved by the unmount flush above — here we just say so honestly.
  useEffect(() => {
    const onComposeAction = (event: Event): void => {
      if ((event as CustomEvent).detail !== 'escape') return
      const draft = draftRef.current
      if (draft && !isComposeDraftEmpty(draft)) toastNow(t('composeDraftFiled'))
      setView('inbox')
    }
    window.addEventListener('paper:compose', onComposeAction)
    return () => window.removeEventListener('paper:compose', onComposeAction)
  }, [setView, t, toastNow])

  // AI output is only put into the editor with the first real chunk.
  // Until then the original text stays visible and can be restored on errors.
  useEffect(
    () =>
      onPush('ai:draftChunk', (payload) => {
        if (payload.draftId !== draftIdRef.current) return
        if (payload.error) {
          const original = activeOriginalRef.current
          if (original) {
            replaceBody(original.body, original.html)
            setSubject(original.subject)
          }
          draftIdRef.current = null
          activeOriginalRef.current = null
          generationStartedRef.current = false
          setCompositionResult(null)
          setFailure({ kind: 'generation', message: payload.error, retryable: true })
          setMode('idle')
          return
        }
        if (payload.compositionMode) {
          setCompositionResult((current) =>
            current
              ? { ...current, resultKind: payload.compositionMode as CompositionMode }
              : current
          )
        }
        if (payload.subject) setSubject((current) => (current.trim() ? current : payload.subject!))
        if (payload.chunk) {
          if (generationStartedRef.current) {
            replaceBody(bodyValueRef.current + payload.chunk)
          } else {
            generationStartedRef.current = true
            replaceBody(payload.chunk)
          }
        }
        if (payload.done) {
          const original = activeOriginalRef.current
          if (!generationStartedRef.current && original) {
            replaceBody(original.body, original.html)
            setSubject(original.subject)
            setCompositionResult(null)
            setFailure({
              kind: 'generation',
              message: t('composerGenerationError'),
              retryable: true
            })
          }
          draftIdRef.current = null
          activeOriginalRef.current = null
          generationStartedRef.current = false
          setMode('idle')
          requestAnimationFrame(() => surfaceRef.current?.focus())
        }
      }),
    [replaceBody, t]
  )

  const draftFromIdea = useCallback((): void => {
    if (!account) return
    const idea = bodyValueRef.current.trim()
    if (!idea) {
      toastNow(t('toastNoIdea'))
      return
    }

    const original = {
      body: bodyValueRef.current,
      subject,
      html: bodyHtmlRef.current
    }
    const requestId = generationRequestRef.current + 1
    generationRequestRef.current = requestId
    activeOriginalRef.current = original
    generationStartedRef.current = false
    setCompositionResult({
      originalBody: original.body,
      originalSubject: original.subject,
      originalHtml: original.html,
      resultKind: null
    })
    setFailure(null)
    setMode('drafting')

    void invoke('ai:draftNew', {
      accountId: account.id,
      to: toList,
      subject,
      idea
    })
      .then(({ draftId }) => {
        if (generationRequestRef.current === requestId) draftIdRef.current = draftId
      })
      .catch((error) => {
        if (generationRequestRef.current !== requestId) return
        replaceBody(original.body, original.html)
        setSubject(original.subject)
        activeOriginalRef.current = null
        generationStartedRef.current = false
        setCompositionResult(null)
        setFailure({
          kind: 'generation',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        })
        setMode('idle')
      })
  }, [account, replaceBody, subject, t, toastNow, toList])

  const transcribeRecording = useCallback(
    async (blob: Blob, seconds: number): Promise<void> => {
      const operation = transcriptionOperationRef.current + 1
      transcriptionOperationRef.current = operation
      lastRecordingRef.current = { blob, seconds }
      setProcessingSeconds(seconds)
      setFailure(null)
      setMode('transcribing')
      try {
        const { blobToWavBase64 } = await import('@renderer/lib/wav')
        const audioBase64 = await blobToWavBase64(blob)
        const { text } = await invoke('ai:transcribe', { audioBase64, format: 'wav' })
        if (transcriptionOperationRef.current !== operation) return
        const transcript = text.trim()
        if (!transcript) throw new Error(t('composerNoRecording'))

        const originalBody = bodyValueRef.current
        const originalHtml = bodyHtmlRef.current
        const nextBody = appendTranscription(originalBody, transcript)
        const nextHtml = originalHtml ? appendTranscriptionHtml(originalHtml, transcript) : ''
        replaceBody(nextBody, nextHtml)
        setCompositionResult({
          originalBody,
          originalSubject: subject,
          originalHtml,
          resultKind: 'transcribed'
        })
        lastRecordingRef.current = null
        setMode('idle')
        requestAnimationFrame(() => surfaceRef.current?.focus())
      } catch (error) {
        if (transcriptionOperationRef.current !== operation) return
        setFailure({
          kind: 'transcription',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        })
        setMode('idle')
      }
    },
    [replaceBody, subject, t]
  )

  const startDictation = useCallback((): void => {
    lastRecordingRef.current = null
    setFailure(null)
    setListeningSeconds(0)
    setMode('listening')
  }, [])

  const finishListening = useCallback((): void => {
    const duration = Math.max(1, listeningSeconds)
    const recordingPromise = takeRecording()
    setProcessingSeconds(duration)
    setMode('transcribing')
    void recordingPromise
      .then((blob) => {
        if (!blob) {
          setFailure({
            kind: 'transcription',
            message: t('composerNoRecording'),
            retryable: false
          })
          setMode('idle')
          return
        }
        return transcribeRecording(blob, duration)
      })
      .catch((error) => {
        setFailure({
          kind: 'transcription',
          message: error instanceof Error ? error.message : String(error),
          retryable: false
        })
        setMode('idle')
      })
  }, [listeningSeconds, takeRecording, t, transcribeRecording])

  const cancelTransient = useCallback((): void => {
    if (mode === 'listening') {
      void takeRecording()
    } else if (mode === 'transcribing') {
      transcriptionOperationRef.current += 1
    } else if (mode === 'drafting') {
      generationRequestRef.current += 1
      draftIdRef.current = null
      const original = activeOriginalRef.current
      if (original) {
        replaceBody(original.body, original.html)
        setSubject(original.subject)
      }
      activeOriginalRef.current = null
      generationStartedRef.current = false
      setCompositionResult(null)
    }
    setMode('idle')
  }, [mode, replaceBody, takeRecording])

  const restoreOriginal = useCallback((): void => {
    if (!compositionResult) return
    replaceBody(compositionResult.originalBody, compositionResult.originalHtml)
    setSubject(compositionResult.originalSubject)
    setCompositionResult(null)
    requestAnimationFrame(() => surfaceRef.current?.focus())
  }, [compositionResult, replaceBody])

  const send = useCallback((): void => {
    if (sending || !account) return
    if (toList.length === 0) {
      toastNow(t('toastNoRecipient'))
      return
    }
    if (!bodyValueRef.current.trim()) return

    setFailure(null)
    setSending(true)
    const htmlBody = bodyHtmlRef.current.trim()
      ? composerHtmlForSend(bodyHtmlRef.current, bodyValueRef.current)
      : undefined
    void invoke('compose:send', {
      accountId: account.id,
      to: toList,
      cc: [...cc, ...parseAddresses(ccText)],
      bcc: [...bcc, ...parseAddresses(bccText)],
      subject,
      textBody: bodyValueRef.current,
      htmlBody,
      replyToMessageId: replyToRef.current ?? undefined
    })
      .then(({ outboxId, sendAt }) => {
        skipDraftSaveRef.current = true
        void saveComposeDraft(null)
        beginSend({
          outboxId,
          sendAt,
          accountId: account.id,
          fromAddr: account.email,
          subject,
          to: toList
        })
        setView('inbox')
      })
      .catch((error) => {
        setFailure({
          kind: 'send',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        })
        setSending(false)
      })
  }, [account, bcc, bccText, beginSend, cc, ccText, sending, setView, subject, t, toList, toastNow])

  const retryFailure = useCallback((): void => {
    if (failure?.kind === 'transcription' && lastRecordingRef.current) {
      const { blob, seconds } = lastRecordingRef.current
      void transcribeRecording(blob, seconds)
    } else if (failure?.kind === 'generation') {
      draftFromIdea()
    } else if (failure?.kind === 'send') {
      send()
    }
  }, [draftFromIdea, failure?.kind, send, transcribeRecording])

  const discard = useCallback((): void => {
    skipDraftSaveRef.current = true
    void saveComposeDraft(null)
    setView('inbox')
  }, [setView])

  const activity: ComposerActivity = sending ? 'sending' : mode === 'drafting' ? 'generating' : mode

  const surfaceError: ComposerError | null = failure
    ? {
        message: failure.message,
        onRetry: failure.retryable ? retryFailure : undefined,
        onDismiss: () => setFailure(null)
      }
    : null

  const fieldLabel: CSSProperties = {
    width: 52,
    flex: 'none',
    font: '500 8.5px var(--mono)',
    letterSpacing: '1.5px',
    color: 'var(--muted)',
    textTransform: 'uppercase',
    paddingTop: 4
  }

  return (
    <div
      className="sheet-card flex min-w-0 flex-1 flex-col overflow-y-auto"
      style={{ padding: '24px 28px' }}
    >
      <div className="flex items-baseline gap-3">
        <div style={{ font: '500 21px var(--serif)' }}>{t('composeHead')}</div>
        <div className="mmeta" style={{ letterSpacing: '.5px' }}>
          {t('composeSub')}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span style={{ font: '400 9px var(--mono)', color: 'var(--faint)' }}>
            {t('composeFrom')}
          </span>
          <FromAccountPicker accounts={accs} account={account} onSelect={switchAccount} />
        </div>
      </div>

      {autoNote && (
        <div
          role="status"
          style={{ font: '400 9.5px var(--mono)', color: 'var(--ac)', marginTop: 10 }}
        >
          {t('composeAutoSwitched', { name: autoNote.name, addr: autoNote.addr })}
        </div>
      )}

      <div style={{ marginTop: autoNote ? 12 : 16, borderTop: '1px solid var(--hairline)' }}>
        <div
          className="flex items-start gap-3"
          style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline-light)' }}
        >
          <span style={fieldLabel}>{t('composeTo')}</span>
          <div className="min-w-0 flex-1">
            <RecipientInput
              label=""
              chips={to}
              onChipsChange={setTo}
              onTextChange={setToText}
              placeholder={t('composeToPh')}
              autoFocus
            />
          </div>
          <div className="flex flex-none gap-2" style={{ paddingTop: 3 }}>
            {!showCc && cc.length === 0 && !ccText && (
              <button type="button" onClick={() => setShowCc(true)} className="composer-reveal-btn">
                + CC
              </button>
            )}
            {!showBcc && bcc.length === 0 && !bccText && (
              <button
                type="button"
                onClick={() => setShowBcc(true)}
                className="composer-reveal-btn"
              >
                + BCC
              </button>
            )}
          </div>
        </div>
        {(showCc || cc.length > 0 || ccText) && (
          <div
            className="flex items-start gap-3"
            style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline-light)' }}
          >
            <span style={fieldLabel}>{t('composeCc')}</span>
            <div className="min-w-0 flex-1">
              <RecipientInput
                label=""
                chips={cc}
                onChipsChange={setCc}
                onTextChange={setCcText}
                autoFocus
              />
            </div>
            {cc.length === 0 && !ccText && (
              <button
                type="button"
                onClick={() => setShowCc(false)}
                className="composer-reveal-btn"
                aria-label={t('composeHideCc')}
              >
                ×
              </button>
            )}
          </div>
        )}
        {(showBcc || bcc.length > 0 || bccText) && (
          <div
            className="flex items-start gap-3"
            style={{ padding: '8px 0', borderBottom: '1px solid var(--hairline-light)' }}
          >
            <span style={fieldLabel}>{t('composeBcc')}</span>
            <div className="min-w-0 flex-1">
              <RecipientInput
                label=""
                chips={bcc}
                onChipsChange={setBcc}
                onTextChange={setBccText}
                autoFocus
              />
            </div>
            {bcc.length === 0 && !bccText && (
              <button
                type="button"
                onClick={() => setShowBcc(false)}
                className="composer-reveal-btn"
                aria-label={t('composeHideBcc')}
              >
                ×
              </button>
            )}
          </div>
        )}
        <div
          className="flex items-baseline gap-3"
          style={{ padding: '10px 0', borderBottom: '1px solid var(--hairline)' }}
        >
          <span style={fieldLabel}>{t('composeSubject')}</span>
          <input
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder={t('composeSubjectPh')}
            className="min-w-0 flex-1"
            style={{
              border: 'none',
              outline: 'none',
              background: 'transparent',
              font: '500 15px var(--serif)',
              color: 'var(--ink)'
            }}
            spellCheck={false}
          />
        </div>
      </div>

      <MailComposerSurface
        ref={surfaceRef}
        variant="new"
        document={{ text: body, html: bodyHtml }}
        activity={activity}
        recordingSeconds={listeningSeconds}
        processingSeconds={processingSeconds}
        audioBars={bars}
        placeholder={t('composerNewPlaceholder')}
        voiceTag={voiceTag}
        signatureConfig={signature.config}
        signatureText={signature.text}
        resultKind={compositionResult?.resultKind}
        error={surfaceError}
        canSend={canSend}
        sendNote={subject.trim() ? null : t('composeNoSubject')}
        onDocumentChange={(nextDocument) => {
          replaceBody(nextDocument.text, nextDocument.html)
          setFailure(null)
          if (compositionResult?.resultKind) setCompositionResult(null)
        }}
        onStartDictation={startDictation}
        onStopDictation={finishListening}
        onCancelTransient={cancelTransient}
        onGenerate={draftFromIdea}
        onSend={send}
        onRestoreOriginal={compositionResult ? restoreOriginal : undefined}
        onDiscard={discard}
        onErrorMessage={toastNow}
      />
    </div>
  )
}
