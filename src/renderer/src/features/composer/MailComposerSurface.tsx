import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import type { SignatureConfig } from '@shared/signature'
import { SignatureContent } from '@renderer/components/SignatureContent'
import { useT } from '@renderer/lib/i18n'
import { sanitizeComposerHtml } from './composer-html'
import { ComposerSpellcheck } from './ComposerSpellcheck'
import {
  composerShortcut,
  escapeHtml,
  estimateTranscriptSkeleton,
  textToComposerHtml,
  type ComposerActivity
} from './composer-state'

export interface ComposerDocument {
  text: string
  html: string
}

export type ComposerResultKind = 'transcribed' | 'dictation' | 'idea' | 'generated'

type ComposerFontSize = '2' | '3' | '4'

export interface ComposerError {
  message: string
  onRetry?: () => void
  onDismiss: () => void
}

export interface MailComposerHandle {
  focus: () => void
}

interface MailComposerSurfaceProps {
  /** 'nudge' = nudge composer of the Waiting view: like reply, only with its own send label. */
  variant: 'new' | 'reply' | 'nudge'
  document: ComposerDocument
  activity: ComposerActivity
  recordingSeconds: number
  processingSeconds: number
  audioBars: number[]
  placeholder: string
  voiceTag: string
  signatureConfig: SignatureConfig | null
  signatureText: string
  resultKind?: ComposerResultKind | null
  error?: ComposerError | null
  canSend: boolean
  /** Subtle mono hint next to the send actions — e.g. NO SUBJECT (Design 3a). */
  sendNote?: string | null
  /** reply: total TO+CC count for reply-all — the send label becomes "SEND TO {n}". */
  sendRecipientCount?: number | null
  autoFocus?: boolean
  onDocumentChange: (document: ComposerDocument) => void
  onStartDictation: () => void
  onStopDictation: () => void
  onCancelTransient: () => void
  onGenerate: () => void
  onSend: () => void
  onRestoreOriginal?: () => void
  onDiscard?: () => void
  onErrorMessage: (message: string) => void
  /** ⌘⇧A in the editor: toggle reply scope (Turn 9). Omit = shortcut inactive. */
  onToggleReplyScope?: () => void
}

function normalizeEditorText(editor: HTMLElement): string {
  return editor.innerText.replace(/\r\n/g, '\n').replace(/\n$/, '')
}

function normalizeLink(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function safePreviewHtml(document: ComposerDocument): string {
  if (!document.html.trim()) return ''
  return sanitizeComposerHtml(document.html)
}

export const MailComposerSurface = forwardRef<MailComposerHandle, MailComposerSurfaceProps>(
  function MailComposerSurface(props, forwardedRef): React.JSX.Element {
    const t = useT()
    const editorRef = useRef<HTMLDivElement>(null)
    const selectionRef = useRef<Range | null>(null)
    const [showFormatting, setShowFormatting] = useState(false)
    const [linkOpen, setLinkOpen] = useState(false)
    const [linkUrl, setLinkUrl] = useState('')
    const [fontSize, setFontSize] = useState<ComposerFontSize>('3')
    const skeleton = useMemo(
      () => estimateTranscriptSkeleton(props.processingSeconds),
      [props.processingSeconds]
    )

    const busy =
      props.activity === 'transcribing' ||
      props.activity === 'generating' ||
      props.activity === 'sending'
    const listening = props.activity === 'listening'
    const canGenerate = props.document.text.trim().length > 0 && !busy && !listening
    const editorLocked = busy

    useImperativeHandle(forwardedRef, () => ({
      focus: () => editorRef.current?.focus()
    }))

    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      const currentText = normalizeEditorText(editor)
      const desiredHtml = props.document.html
      if (
        currentText === props.document.text &&
        (!desiredHtml || editor.innerHTML === desiredHtml)
      ) {
        return
      }
      // Never put raw text into the editor: without <div> blocks there would be \n in
      // innerHTML, and the next edit would send HTML without line breaks.
      if (desiredHtml) editor.innerHTML = desiredHtml
      else editor.innerHTML = textToComposerHtml(props.document.text)
    }, [props.document.html, props.document.text])

    useEffect(() => {
      if (props.autoFocus) requestAnimationFrame(() => editorRef.current?.focus())
    }, [props.autoFocus])

    const rememberSelection = (): void => {
      const selection = window.getSelection()
      const editor = editorRef.current
      if (!selection || selection.rangeCount === 0 || !editor) return
      const range = selection.getRangeAt(0)
      if (editor.contains(range.commonAncestorContainer)) selectionRef.current = range.cloneRange()
    }

    const restoreSelection = (): void => {
      const selection = window.getSelection()
      const range = selectionRef.current
      if (!selection || !range) return
      selection.removeAllRanges()
      selection.addRange(range)
    }

    const emitDocument = (): void => {
      const editor = editorRef.current
      if (!editor) return
      props.onDocumentChange({ text: normalizeEditorText(editor), html: editor.innerHTML })
      rememberSelection()
    }

    const applyCommand = (command: 'bold' | 'italic' | 'underline', value?: string): void => {
      editorRef.current?.focus()
      restoreSelection()
      document.execCommand(command, false, value)
      emitDocument()
    }

    const applyFontSize = (size: ComposerFontSize): void => {
      editorRef.current?.focus()
      restoreSelection()
      document.execCommand('fontSize', false, size)
      setFontSize(size)
      emitDocument()
    }

    const applyLink = (): void => {
      const href = normalizeLink(linkUrl)
      if (!href) {
        props.onErrorMessage(t('toastInvalidLink'))
        return
      }
      editorRef.current?.focus()
      restoreSelection()
      const selection = window.getSelection()
      if (selection?.isCollapsed) {
        const label = href.replace(/^mailto:/, '')
        document.execCommand(
          'insertHTML',
          false,
          `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
        )
      } else {
        document.execCommand('createLink', false, href)
      }
      setLinkOpen(false)
      setLinkUrl('')
      emitDocument()
    }

    const handleShortcut = (event: React.KeyboardEvent): void => {
      const shortcut = composerShortcut(event)
      if (!shortcut) return
      if (shortcut === 'cancel') {
        if (props.activity === 'idle') return
        event.preventDefault()
        props.onCancelTransient()
      } else if (shortcut === 'send') {
        if (!props.canSend || busy || listening) return
        event.preventDefault()
        props.onSend()
      } else if (shortcut === 'dictate') {
        if (busy) return
        event.preventDefault()
        if (listening) props.onStopDictation()
        else props.onStartDictation()
      } else if (shortcut === 'generate') {
        if (!canGenerate) return
        event.preventDefault()
        props.onGenerate()
      } else if (shortcut === 'format') {
        if (busy || listening) return
        event.preventDefault()
        setShowFormatting((visible) => !visible)
      } else if (shortcut === 'replyScope') {
        if (!props.onToggleReplyScope || busy || listening) return
        event.preventDefault()
        props.onToggleReplyScope()
      }
      event.stopPropagation()
    }

    const mm = String(Math.floor(props.recordingSeconds / 60)).padStart(2, '0')
    const ss = String(props.recordingSeconds % 60).padStart(2, '0')
    const previewHtml = safePreviewHtml(props.document)
    const resultLabel =
      props.resultKind === 'transcribed'
        ? t('composerDictationInserted')
        : props.resultKind === 'dictation'
          ? t('composeDictationPolished')
          : props.resultKind === 'idea'
            ? t('composeIdeaDrafted')
            : props.resultKind === 'generated'
              ? t('composerGenerated')
              : null

    return (
      <section
        className="mail-composer"
        data-variant={props.variant}
        data-state={props.activity}
        aria-busy={busy}
        onKeyDown={handleShortcut}
      >
        <div className="mail-composer__frame">
          {showFormatting && (
            <div
              className="mail-composer__formatbar"
              role="toolbar"
              aria-label={t('composeFormatting')}
            >
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyCommand('bold')}
                aria-label={t('composeBold')}
              >
                <b>B</b>
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyCommand('italic')}
                aria-label={t('composeItalic')}
              >
                <i>I</i>
              </button>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => applyCommand('underline')}
                aria-label={t('composeUnderline')}
              >
                <u>U</u>
              </button>
              <div
                className="mail-composer__size-control"
                role="group"
                aria-label={t('composeFontSize')}
              >
                <button
                  type="button"
                  className="mail-composer__size-option mail-composer__size-option--small"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyFontSize('2')}
                  aria-label={t('composeSizeSmall')}
                  aria-pressed={fontSize === '2'}
                  title={t('composeSizeSmall')}
                >
                  <span aria-hidden="true">A-</span>
                </button>
                <button
                  type="button"
                  className="mail-composer__size-option mail-composer__size-option--normal"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyFontSize('3')}
                  aria-label={t('composeSizeNormal')}
                  aria-pressed={fontSize === '3'}
                  title={t('composeSizeNormal')}
                >
                  <span aria-hidden="true">A</span>
                </button>
                <button
                  type="button"
                  className="mail-composer__size-option mail-composer__size-option--large"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => applyFontSize('4')}
                  aria-label={t('composeSizeLarge')}
                  aria-pressed={fontSize === '4'}
                  title={t('composeSizeLarge')}
                >
                  <span aria-hidden="true">A+</span>
                </button>
              </div>
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault()
                  rememberSelection()
                }}
                onClick={() => setLinkOpen((open) => !open)}
              >
                {t('composeLink')}
              </button>
              {linkOpen && (
                <div className="mail-composer__link-field">
                  <input
                    value={linkUrl}
                    onChange={(event) => setLinkUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        applyLink()
                      } else if (event.key === 'Escape') {
                        event.preventDefault()
                        setLinkOpen(false)
                        setLinkUrl('')
                        editorRef.current?.focus()
                      }
                      event.stopPropagation()
                    }}
                    placeholder="https://…"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="mail-composer__link-apply"
                    onClick={applyLink}
                    aria-label={t('composeApply')}
                    title={t('composeApply')}
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="m4 10.5 3.5 3.5L16 5.5" />
                    </svg>
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={() => setShowFormatting(false)}
                className="ml-auto"
                aria-label={t('composeHideFormatting')}
              >
                ×
              </button>
            </div>
          )}

          <div
            className="mail-composer__editor-shell"
            data-processing={props.activity === 'transcribing'}
          >
            <div
              ref={editorRef}
              contentEditable={!editorLocked}
              suppressContentEditableWarning
              role="textbox"
              aria-label={props.placeholder}
              aria-multiline="true"
              aria-readonly={editorLocked}
              data-placeholder={props.activity === 'transcribing' ? '' : props.placeholder}
              className="mail-composer__editor"
              onInput={emitDocument}
              onMouseUp={rememberSelection}
              onKeyUp={rememberSelection}
              onPaste={(event) => {
                event.preventDefault()
                document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
                emitDocument()
              }}
              // Own Hunspell check (DE+EN) instead of the native one — it
              // recognizes too little for single words (see src/main/spell/).
              spellCheck={false}
            />
            <ComposerSpellcheck
              editorRef={editorRef}
              text={props.document.text}
              disabled={busy}
              onDidEdit={emitDocument}
            />
            {props.activity === 'transcribing' && (
              <div className="mail-composer__processing-copy" aria-hidden="true">
                {props.document.text &&
                  (previewHtml ? (
                    <div
                      className="mail-composer__existing-copy"
                      dangerouslySetInnerHTML={{ __html: previewHtml }}
                    />
                  ) : (
                    <div className="mail-composer__existing-copy">{props.document.text}</div>
                  ))}
                <div className="mail-composer__skeleton">
                  {skeleton.widths.map((width, index) => (
                    <span
                      key={index}
                      className="mail-composer__skeleton-line"
                      style={{ width: `${width}%` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {props.activity === 'listening' && (
            <div
              className="mail-composer__status mail-composer__status--recording"
              role="status"
              aria-live="polite"
            >
              <span className="mail-composer__live-dot" aria-hidden="true" />
              <span className="mail-composer__status-label">
                {t('composerListening')} {mm}:{ss}
              </span>
              <span className="mail-composer__meter" aria-hidden="true">
                {props.audioBars.map((height, index) => (
                  <span
                    key={index}
                    className="mail-composer__meter-bar"
                    style={{ height: Math.round(height) }}
                  />
                ))}
              </span>
              <button
                type="button"
                onClick={props.onStopDictation}
                className="mail-composer__status-action"
              >
                {t('composerStopRecording')}
              </button>
            </div>
          )}

          {props.activity === 'transcribing' && (
            <div className="mail-composer__status" role="status" aria-live="polite">
              <span className="mail-composer__status-label">{t('composerTranscribing')}</span>
              <span className="mail-composer__status-note">{t('composerKeepsText')}</span>
            </div>
          )}

          {props.activity === 'generating' && (
            <div className="mail-composer__status" role="status" aria-live="polite">
              <span className="mail-composer__status-label">{t('composerGenerating')}</span>
              <span className="mail-composer__status-note">
                {t('voicePrefix')} {props.voiceTag}
              </span>
            </div>
          )}

          {props.error && (
            <div className="mail-composer__error" role="alert">
              <span>{props.error.message}</span>
              <span className="mail-composer__error-actions">
                {props.error.onRetry && (
                  <button type="button" onClick={props.error.onRetry}>
                    {t('composerRetry')}
                  </button>
                )}
                <button type="button" onClick={props.error.onDismiss}>
                  {t('composerDismiss')}
                </button>
              </span>
            </div>
          )}

          {props.activity === 'idle' && resultLabel && (
            <div className="mail-composer__result" role="status">
              <span>{resultLabel}</span>
              {props.onRestoreOriginal && (
                <button type="button" onClick={props.onRestoreOriginal}>
                  {t('composerRestoreOriginal')}
                </button>
              )}
            </div>
          )}

          {(props.signatureConfig || props.signatureText) && (
            <div className="mail-composer__signature">
              {props.signatureConfig ? (
                <SignatureContent config={props.signatureConfig} />
              ) : (
                <div className="mail-composer__signature-text">{props.signatureText}</div>
              )}
            </div>
          )}

          <div className="mail-composer__actions">
            <div className="mail-composer__action-grid">
              <button
                type="button"
                className="composer-action composer-action--primary"
                onClick={props.onSend}
                disabled={!props.canSend || busy || listening}
                aria-keyshortcuts="Meta+Enter Control+Enter"
              >
                <span>
                  {props.activity === 'sending'
                    ? t('composerSending')
                    : props.variant === 'reply'
                      ? props.sendRecipientCount && props.sendRecipientCount > 1
                        ? t('sendToN', { n: props.sendRecipientCount })
                        : t('composerSendReply')
                      : props.variant === 'nudge'
                        ? t('sendNudge')
                        : t('composerSendMessage')}
                </span>
                <kbd>⌘↵</kbd>
              </button>
              <button
                type="button"
                className="composer-action composer-action--ai"
                onClick={props.onGenerate}
                disabled={!canGenerate}
                aria-keyshortcuts="Meta+J Control+J"
              >
                <span className="composer-action__icon" aria-hidden="true">
                  ✦
                </span>
                <span>{t('composerGenerate')}</span>
                <kbd>⌘J</kbd>
              </button>
              <button
                type="button"
                className="composer-action"
                data-active={listening}
                onClick={listening ? props.onStopDictation : props.onStartDictation}
                disabled={busy}
                aria-pressed={listening}
                aria-keyshortcuts="Meta+D Control+D"
              >
                <span className="composer-action__record-mark" aria-hidden="true" />
                <span>{listening ? t('composerStopRecording') : t('composerDictate')}</span>
                <kbd>⌘D</kbd>
              </button>
              <button
                type="button"
                className="composer-action"
                data-active={showFormatting}
                onClick={() => setShowFormatting((visible) => !visible)}
                disabled={busy || listening}
                aria-pressed={showFormatting}
                aria-keyshortcuts="Meta+Shift+F Control+Shift+F"
              >
                <span
                  className="composer-action__icon composer-action__icon--format"
                  aria-hidden="true"
                >
                  Aa
                </span>
                <span>{t('composerFormat')}</span>
                <kbd>⌘⇧F</kbd>
              </button>
            </div>
            {(props.sendNote || (props.onDiscard && props.document.text.trim())) && (
              <div className="mail-composer__actions-foot">
                {props.sendNote && (
                  <span className="mail-composer__send-note" role="status">
                    {props.sendNote}
                  </span>
                )}
                {props.onDiscard && props.document.text.trim() && (
                  <button
                    type="button"
                    className="composer-action composer-action--quiet"
                    onClick={props.onDiscard}
                    disabled={busy || listening}
                  >
                    {t('composerDiscard')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    )
  }
)
