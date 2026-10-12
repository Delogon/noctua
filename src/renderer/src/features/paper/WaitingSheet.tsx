import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, onPush } from '@renderer/lib/ipc'
import { useQueryClient } from '@tanstack/react-query'
import { useFollowups } from '@renderer/queries/followups'
import { useAccounts } from '@renderer/queries/accounts'
import { usePaper } from '@renderer/stores/paper'
import { useNudge } from '@renderer/stores/nudge'
import { SheetEmpty } from '@renderer/components/paper/SheetEmpty'
import { useT } from '@renderer/lib/i18n'
import { useSendState } from '@renderer/stores/send'
import { useThread } from '@renderer/queries/threads'
import { OriginalMailBody } from '@renderer/components/OriginalMailBody'
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
  textToComposerHtml,
  type ComposerActivity
} from '@renderer/features/composer/composer-state'
import { useListeningAudio } from '@renderer/features/paper/useListeningAudio'
import { useVoiceTag } from '@renderer/features/paper/useVoiceTag'
import { buildNudgeSend, nudgedToday } from '@renderer/features/paper/nudge-send'

// Waiting sheet: SILENCE callout + the nudge as a real composer. The
// automatically drafted follow-up streams into the same editor field as a
// reply — afterwards everything is editable (typing, ⌘D dictation, ⌘J rewrite,
// formatting); the send path appends the sending account's signature.

/** Debounced draft persistence — thread switch/restart finds the state again. */
const SAVE_DEBOUNCE_MS = 800

export function WaitingSheet(): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const followups = useFollowups()
  const accounts = useAccounts()
  const beginSend = useSendState((st) => st.begin)
  const { selWaitingId, toastNow } = usePaper()

  const items = followups.data ?? []
  const sel = items.find((w) => w.messageId === selWaitingId) ?? items[0]
  const thread = useThread(sel?.threadKey ?? null)
  const originalMessage = thread.data?.find((message) => message.id === sel?.messageId)

  const nudge = useNudge()
  const account = accounts.data?.find((a) => a.id === sel?.accountId)
  const voiceTag = useVoiceTag(sel?.accountId ?? null, account?.accountName ?? null)
  // Signature of the account that SENT the original mail — the same
  // display (and the same send path) as in the reply composer.
  const signature = useAccountSignature(account)
  const composerRef = useRef<MailComposerHandle>(null)
  const transcriptionOpRef = useRef(0)
  const [hasRetryableRecording, setHasRetryableRecording] = useState(false)
  const lastRecordingRef = useRef<{ blob: Blob; messageId: number; seconds: number } | null>(null)
  const { bars, takeRecording } = useListeningAudio(
    nudge.mode === 'listening' && nudge.messageId === sel?.messageId
  )

  // ── Draft persistence (followups:saveNudge, debounced) ──
  const pendingSaveRef = useRef<{ messageId: number; draft: string } | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushSave = useCallback((): void => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    const pending = pendingSaveRef.current
    pendingSaveRef.current = null
    if (!pending) return
    void invoke('followups:saveNudge', pending).then(
      () => void queryClient.invalidateQueries({ queryKey: ['followups'] })
    )
  }, [queryClient])

  const scheduleSave = useCallback(
    (messageId: number, draft: string): void => {
      // Respect the column's contract limit (nudge_draft, max. 10,000 characters)
      pendingSaveRef.current = { messageId, draft: draft.slice(0, 10_000) }
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(flushSave, SAVE_DEBOUNCE_MS)
    },
    [flushSave]
  )

  // Unmount (view switch): still send off any pending save
  useEffect(() => flushSave, [flushSave])

  // ── Drafting (auto-draft and ⌘J with the editor text as basis) ──
  const generate = useCallback((messageId: number, idea?: string): void => {
    const st = useNudge.getState()
    const keepOriginal = idea !== undefined && st.messageId === messageId
    st.setNudge({
      messageId,
      mode: 'drafting',
      text: '',
      html: '',
      originalText: keepOriginal ? st.text : '',
      originalHtml: keepOriginal ? st.html : '',
      resultKind: null,
      error: null,
      errorKind: null,
      draftId: null,
      generationStarted: false
    })
    void invoke(
      'followups:draftNudge',
      idea?.trim() ? { messageId, idea: idea.trim() } : { messageId }
    )
      .then(({ draftId }) => {
        const cur = useNudge.getState()
        if (cur.messageId === messageId && cur.mode === 'drafting') cur.setNudge({ draftId })
      })
      .catch((err) => {
        const cur = useNudge.getState()
        if (cur.messageId !== messageId) return
        cur.setNudge({
          mode: cur.originalText.trim() ? 'ready' : 'idle',
          text: cur.originalText,
          html: cur.originalHtml,
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'generation',
          draftId: null,
          generationStarted: false
        })
      })
  }, [])

  // Put a cached nudge into the composer immediately; only redraft without a cache
  useEffect(() => {
    if (!sel) return
    const st = useNudge.getState()
    if (st.messageId === sel.messageId) return
    flushSave()
    st.resetNudge(sel.messageId)
    if (nudgedToday(sel.nudgedAt)) return
    if (sel.nudgeDraft) {
      useNudge.getState().setNudge({
        mode: 'ready',
        text: sel.nudgeDraft,
        html: textToComposerHtml(sel.nudgeDraft)
      })
      return
    }
    generate(sel.messageId)
  }, [sel, flushSave, generate])

  // Receive draft streaming (same pattern as the reply composer)
  useEffect(
    () =>
      onPush('ai:draftChunk', (payload) => {
        const st = useNudge.getState()
        if (st.messageId == null || payload.draftId !== st.draftId) return
        if (payload.error) {
          st.setNudge({
            mode: st.originalText.trim() ? 'ready' : 'idle',
            text: st.originalText,
            html: st.originalHtml,
            resultKind: null,
            error: payload.error,
            errorKind: 'generation',
            draftId: null,
            generationStarted: false
          })
          return
        }
        if (payload.chunk) {
          st.setNudge({
            mode: 'drafting',
            text: st.generationStarted ? st.text + payload.chunk : payload.chunk,
            html: '',
            generationStarted: true
          })
        }
        if (payload.done) {
          const latest = useNudge.getState()
          if (!latest.generationStarted) {
            latest.setNudge({
              mode: latest.originalText.trim() ? 'ready' : 'idle',
              text: latest.originalText,
              html: latest.originalHtml,
              resultKind: null,
              error: t('composerGenerationError'),
              errorKind: 'generation',
              draftId: null
            })
            return
          }
          latest.setNudge({
            mode: 'ready',
            resultKind: 'generated',
            error: null,
            errorKind: null,
            draftId: null,
            generationStarted: false
          })
          const finished = latest.text.trim()
          if (finished && latest.messageId != null) {
            void invoke('followups:saveNudge', {
              messageId: latest.messageId,
              draft: finished.slice(0, 10_000)
            }).then(() => void queryClient.invalidateQueries({ queryKey: ['followups'] }))
          }
          requestAnimationFrame(() => composerRef.current?.focus())
        }
      }),
    [queryClient, t]
  )

  // ── Dictation (⌘D) — revises the existing text as in the reply flow ──
  const startDictation = useCallback((): void => {
    if (!sel || nudgedToday(sel.nudgedAt)) return
    const st = useNudge.getState()
    if (
      st.messageId === sel.messageId &&
      (st.mode === 'transcribing' || st.mode === 'drafting' || st.mode === 'sending')
    ) {
      return
    }
    const sameNudge = st.messageId === sel.messageId
    lastRecordingRef.current = null
    setHasRetryableRecording(false)
    st.setNudge({
      messageId: sel.messageId,
      mode: 'listening',
      secs: 0,
      processingSeconds: 0,
      text: sameNudge ? st.text : '',
      html: sameNudge ? st.html : '',
      originalText: '',
      originalHtml: '',
      resultKind: null,
      error: null,
      errorKind: null,
      draftId: null,
      generationStarted: false
    })
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [sel])

  const processRecording = useCallback(
    (blob: Blob, messageId: number, seconds: number, operation: number): void => {
      void (async () => {
        const { blobToWavBase64 } = await import('@renderer/lib/wav')
        const audioBase64 = await blobToWavBase64(blob)
        const result = await invoke('ai:transcribe', { audioBase64, format: 'wav' })
        if (transcriptionOpRef.current !== operation) return
        const current = useNudge.getState()
        if (current.messageId !== messageId) return
        const transcript = result.text.trim()
        if (!transcript) {
          current.setNudge({
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
        current.setNudge({
          mode: 'ready',
          text: nextText,
          html: nextHtml,
          processingSeconds: seconds,
          resultKind: 'transcribed',
          error: null,
          errorKind: null
        })
        scheduleSave(messageId, nextText)
        requestAnimationFrame(() => composerRef.current?.focus())
      })().catch((err) => {
        if (transcriptionOpRef.current !== operation) return
        const current = useNudge.getState()
        if (current.messageId !== messageId) return
        current.setNudge({
          mode: current.text.trim() ? 'ready' : 'idle',
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'transcription',
          resultKind: null
        })
      })
    },
    [scheduleSave]
  )

  const finishListening = useCallback((): void => {
    const st = useNudge.getState()
    if (st.mode !== 'listening' || st.messageId == null) return
    const messageId = st.messageId
    const seconds = Math.max(1, st.secs)
    const operation = ++transcriptionOpRef.current
    st.setNudge({
      mode: 'transcribing',
      processingSeconds: seconds,
      originalText: st.text,
      originalHtml: st.html,
      resultKind: null,
      error: null,
      errorKind: null
    })
    void takeRecording()
      .then((blob) => {
        if (transcriptionOpRef.current !== operation) return
        if (!blob) {
          const current = useNudge.getState()
          current.setNudge({
            mode: current.text.trim() ? 'ready' : 'idle',
            error: t('composerNoRecording'),
            errorKind: null
          })
          return
        }
        lastRecordingRef.current = { blob, messageId, seconds }
        setHasRetryableRecording(true)
        processRecording(blob, messageId, seconds, operation)
      })
      .catch((err) => {
        if (transcriptionOpRef.current !== operation) return
        const current = useNudge.getState()
        current.setNudge({
          mode: current.text.trim() ? 'ready' : 'idle',
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'transcription'
        })
      })
  }, [processRecording, t, takeRecording])

  const retryTranscription = useCallback((): void => {
    const recording = lastRecordingRef.current
    if (!recording || recording.messageId !== sel?.messageId) return
    const st = useNudge.getState()
    const operation = ++transcriptionOpRef.current
    st.setNudge({
      mode: 'transcribing',
      processingSeconds: recording.seconds,
      originalText: st.text,
      originalHtml: st.html,
      error: null,
      errorKind: null,
      resultKind: null
    })
    processRecording(recording.blob, recording.messageId, recording.seconds, operation)
  }, [processRecording, sel?.messageId])

  // Clock while listening
  useEffect(() => {
    if (nudge.mode !== 'listening') return
    const iv = setInterval(() => {
      const st = useNudge.getState()
      st.setNudge({ secs: st.secs + 1 })
    }, 1000)
    return () => clearInterval(iv)
  }, [nudge.mode])

  // ⌘J: the editor text is the basis — the owl rewrites the nudge
  const elaborate = useCallback((): void => {
    if (!sel || nudgedToday(sel.nudgedAt)) return
    const st = useNudge.getState()
    if (st.messageId !== sel.messageId) return
    if (
      st.mode === 'listening' ||
      st.mode === 'transcribing' ||
      st.mode === 'drafting' ||
      st.mode === 'sending'
    ) {
      return
    }
    const idea = st.text.trim()
    if (!idea) return
    generate(sel.messageId, idea)
  }, [sel, generate])

  const sendNudge = useCallback((): void => {
    if (!sel || nudgedToday(sel.nudgedAt)) return
    const st = useNudge.getState()
    if (st.messageId !== sel.messageId || !st.text.trim()) return
    if (
      st.mode === 'listening' ||
      st.mode === 'transcribing' ||
      st.mode === 'drafting' ||
      st.mode === 'sending'
    ) {
      return
    }
    const senderAccount = accounts.data?.find((a) => a.id === sel.accountId)
    if (!senderAccount || sel.toAddrs.length === 0) return
    // Deliberately do NOT append the signature: sendMail adds the sending
    // account's signature exactly once — exactly the same path as for replies.
    const payload = buildNudgeSend(sel, st.text, composerHtmlForSend(st.html, st.text))
    flushSave()
    st.setNudge({ mode: 'sending', error: null, errorKind: null })
    void invoke('compose:send', payload)
      .then(({ outboxId, sendAt }) => {
        beginSend({
          outboxId,
          sendAt,
          accountId: sel.accountId,
          fromAddr: senderAccount.email,
          subject: payload.subject,
          to: payload.to
        })
        // Persisted — „HEUTE GESTUPST" survives view switches and restarts
        void invoke('followups:markNudged', { messageId: sel.messageId })
        toastNow(t('toastNudgeSent', { name: sel.toAddrs[0] ?? '?' }))
        const cur = useNudge.getState()
        if (cur.messageId === sel.messageId) cur.setNudge({ mode: 'idle', resultKind: null })
      })
      .catch((err) => {
        const cur = useNudge.getState()
        if (cur.messageId !== sel.messageId) return
        cur.setNudge({
          mode: 'ready',
          error: err instanceof Error ? err.message : String(err),
          errorKind: 'send'
        })
      })
  }, [sel, accounts.data, beginSend, toastNow, t, flushSave])

  const updateDocument = useCallback(
    (document: ComposerDocument): void => {
      if (!sel) return
      const st = useNudge.getState()
      if (st.messageId !== sel.messageId) return
      st.setNudge({
        mode: st.mode === 'listening' ? 'listening' : document.text.trim() ? 'ready' : 'idle',
        text: document.text,
        html: document.html,
        error: null,
        errorKind: null
      })
      scheduleSave(sel.messageId, document.text)
    },
    [sel, scheduleSave]
  )

  const restoreOriginal = useCallback((): void => {
    if (!sel) return
    const st = useNudge.getState()
    if (st.messageId !== sel.messageId || !st.resultKind) return
    st.setNudge({
      mode: st.originalText.trim() ? 'ready' : 'idle',
      text: st.originalText,
      html: st.originalHtml,
      originalText: '',
      originalHtml: '',
      resultKind: null,
      error: null,
      errorKind: null
    })
    scheduleSave(sel.messageId, st.originalText)
    requestAnimationFrame(() => composerRef.current?.focus())
  }, [sel, scheduleSave])

  const cancelTransient = useCallback((): void => {
    if (!sel) return
    const st = useNudge.getState()
    if (st.messageId !== sel.messageId || st.mode === 'sending') return
    transcriptionOpRef.current += 1
    if (st.mode === 'listening') void takeRecording()
    if (st.mode === 'drafting') {
      st.setNudge({
        mode: st.originalText.trim() ? 'ready' : 'idle',
        text: st.originalText,
        html: st.originalHtml,
        resultKind: null,
        error: null,
        errorKind: null,
        draftId: null,
        generationStarted: false
      })
    } else if (st.mode === 'listening' || st.mode === 'transcribing') {
      st.setNudge({
        mode: st.text.trim() ? 'ready' : 'idle',
        error: null,
        errorKind: null,
        draftId: null
      })
    }
  }, [sel, takeRecording])

  const dismissError = useCallback((): void => {
    const st = useNudge.getState()
    if (sel && st.messageId === sel.messageId) st.setNudge({ error: null, errorKind: null })
  }, [sel])

  const retryError = useCallback((): void => {
    if (!sel) return
    const st = useNudge.getState()
    if (st.messageId !== sel.messageId) return
    if (st.errorKind === 'transcription') retryTranscription()
    else if (st.errorKind === 'generation') {
      // After a failed auto-draft the editor is empty → draft fresh
      const idea = st.text.trim()
      generate(sel.messageId, idea || undefined)
    } else if (st.errorKind === 'send') sendNudge()
  }, [sel, retryTranscription, generate, sendNudge])

  const drop = useCallback((): void => {
    if (!sel) return
    void invoke('followups:dismiss', { messageId: sel.messageId }).then(() => {
      toastNow(t('toastStopWaiting', { name: sel.toAddrs[0] ?? '?' }))
      const st = useNudge.getState()
      if (st.messageId === sel.messageId) st.resetNudge()
      void queryClient.invalidateQueries({ queryKey: ['followups'] })
    })
  }, [sel, toastNow, t, queryClient])

  // Keymap actions (custom events from keymap.ts) — ⌘↵ stays the only
  // send gate of the Waiting view (M52): a bare Enter never reaches us.
  useEffect(() => {
    const onAction = (e: Event): void => {
      const action = (e as CustomEvent<string>).detail
      const mode = useNudge.getState().mode
      if (action === 'enter') {
        if (mode === 'listening') finishListening()
        else sendNudge()
      } else if (action === 'drop') drop()
      else if (action === 'dictate') {
        if (mode === 'listening') finishListening()
        else startDictation()
      } else if (action === 'elaborate') elaborate()
      else if (action === 'escape') {
        if (mode === 'listening' || mode === 'transcribing' || mode === 'drafting') {
          cancelTransient()
        }
      }
    }
    window.addEventListener('paper:waiting', onAction)
    return () => window.removeEventListener('paper:waiting', onAction)
  }, [sendNudge, drop, startDictation, finishListening, elaborate, cancelTransient])

  if (!sel) return <SheetEmpty line={t('waitingEmpty')} sub={t('waitingEmptySub')} />

  const isNudged = nudgedToday(sel.nudgedAt)
  const days = sel.daysWaiting

  const nudgeHere = nudge.messageId === sel.messageId
  const composerDocument: ComposerDocument = nudgeHere
    ? { text: nudge.text, html: nudge.html }
    : { text: '', html: '' }
  const composerActivity: ComposerActivity = !nudgeHere
    ? 'idle'
    : nudge.mode === 'drafting'
      ? 'generating'
      : nudge.mode === 'ready' || nudge.mode === 'idle'
        ? 'idle'
        : nudge.mode
  const canRetryError =
    nudge.errorKind === 'generation' ||
    nudge.errorKind === 'send' ||
    (nudge.errorKind === 'transcription' && hasRetryableRecording)
  const composerError =
    nudgeHere && nudge.error
      ? {
          message: nudge.error,
          ...(canRetryError ? { onRetry: retryError } : {}),
          onDismiss: dismissError
        }
      : null

  return (
    <div className="sheet-card min-w-0 flex-1 overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div style={{ font: '500 21px var(--serif)' }}>{sel.subject ?? '—'}</div>
      <div className="mmeta" style={{ marginTop: 5, letterSpacing: '.5px' }}>
        {t('youArrow')} {(sel.toAddrs[0] ?? '?').toUpperCase()} ·{' '}
        {days === 0 ? t('sentToday') : t('sentDaysAgo', { d: days })}
      </div>
      <div
        className="flex items-center gap-2.5"
        style={{ border: '1px solid var(--ac)', padding: '8px 12px', marginTop: 16 }}
      >
        <span className="mlabel flex-none" style={{ fontSize: 8, color: 'var(--ac)' }}>
          {t('silence')}
        </span>
        <span
          style={{ font: '400 13px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }}
        >
          {days === 0 ? t('silenceToday') : t('silenceLine', { d: days })}
        </span>
      </div>
      <div className="double-rule" style={{ marginTop: 18 }} />

      {!isNudged ? (
        <>
          <div className="flex items-baseline gap-2" style={{ marginTop: 14 }}>
            <span className="mlabel" style={{ color: 'var(--ac)' }}>
              {t('nudgeLabel')}
            </span>
            <span style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>
              {t('nudgeSub')}
            </span>
          </div>
          <div style={{ marginTop: 10 }}>
            <MailComposerSurface
              ref={composerRef}
              variant="nudge"
              document={composerDocument}
              activity={composerActivity}
              recordingSeconds={nudgeHere ? nudge.secs : 0}
              processingSeconds={nudgeHere ? nudge.processingSeconds : 0}
              audioBars={bars}
              placeholder={t('composerNudgePlaceholder')}
              voiceTag={voiceTag}
              signatureConfig={signature.config}
              signatureText={signature.text}
              resultKind={nudgeHere ? nudge.resultKind : null}
              error={composerError}
              canSend={Boolean(nudgeHere && nudge.text.trim() && account && sel.toAddrs.length > 0)}
              onDocumentChange={updateDocument}
              onStartDictation={startDictation}
              onStopDictation={finishListening}
              onCancelTransient={cancelTransient}
              onGenerate={elaborate}
              onSend={sendNudge}
              onRestoreOriginal={nudgeHere && nudge.resultKind ? restoreOriginal : undefined}
              onErrorMessage={toastNow}
            />
          </div>
          <div className="waiting-actions">
            <button type="button" onClick={drop} className="waiting-action">
              <span className="waiting-action-icon waiting-action-key" aria-hidden="true">
                D
              </span>
              <span>{t('stopWaiting')}</span>
            </button>
          </div>
        </>
      ) : (
        <div
          className="flex items-center gap-2.5"
          style={{ marginTop: 16, padding: '10px 12px', border: '1px dashed var(--hairline)' }}
        >
          <span className="mlabel flex-none" style={{ color: 'var(--ac)' }}>
            {t('nudgedToday')}
          </span>
          <span
            style={{
              font: '400 13px var(--serif)',
              fontStyle: 'italic',
              color: 'var(--secondary)'
            }}
          >
            {t('nudgedNote')}
          </span>
        </div>
      )}

      <div className="double-rule" style={{ marginTop: 20 }} />
      <div className="mmeta" style={{ marginTop: 14, letterSpacing: '1.5px' }}>
        {t('originalSentMail')}
      </div>
      <div className="tint-card" style={{ padding: '12px 14px', marginTop: 8 }}>
        <OriginalMailBody message={originalMessage} loading={thread.isLoading} />
      </div>
    </div>
  )
}
