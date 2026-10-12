export type ComposerActivity = 'idle' | 'listening' | 'transcribing' | 'generating' | 'sending'

export type ComposerShortcut = 'send' | 'dictate' | 'generate' | 'format' | 'replyScope' | 'cancel'

interface ShortcutEvent {
  key: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  isComposing?: boolean
}

export interface TranscriptSkeleton {
  lineCount: number
  widths: number[]
}

const SKELETON_LINE_WIDTHS = [94, 86, 91, 79]

export function composerShortcut(event: ShortcutEvent): ComposerShortcut | null {
  if (event.isComposing) return null
  if (event.key === 'Escape') return 'cancel'

  const command = event.metaKey || event.ctrlKey
  if (!command) return null
  const key = event.key.toLowerCase()
  if (key === 'enter') return 'send'
  if (key === 'd' && !event.shiftKey) return 'dictate'
  if (key === 'j' && !event.shiftKey) return 'generate'
  if (key === 'f' && event.shiftKey) return 'format'
  if (key === 'a' && event.shiftKey) return 'replyScope'
  return null
}

/**
 * Estimates the text area of a dictation from its duration. The sequence is
 * deliberately deterministic so the skeleton does not jump while rendering.
 */
export function estimateTranscriptSkeleton(seconds: number): TranscriptSkeleton {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const lineCount = Math.max(1, Math.min(12, Math.ceil(Math.max(1, safeSeconds) / 5)))
  const widths = Array.from(
    { length: lineCount },
    (_, index) => SKELETON_LINE_WIDTHS[index % SKELETON_LINE_WIDTHS.length]
  )
  const finalWidth = Math.max(38, Math.min(82, 38 + ((Math.round(safeSeconds) * 13) % 45)))
  widths[widths.length - 1] = finalWidth
  return { lineCount, widths }
}

export function appendTranscription(currentText: string, transcript: string): string {
  const current = currentText.trimEnd()
  const spoken = transcript.trim()
  if (!spoken) return current
  return current ? `${current}\n\n${spoken}` : spoken
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * Converts plain text into the editor's block structure (\n → <div> lines).
 * Raw text must never land directly as innerHTML/textContent in the editor: its
 * innerHTML would have \n instead of <div>/<br>, and the line breaks would be lost
 * when sending the HTML alternative.
 */
export function textToComposerHtml(text: string): string {
  if (!text) return ''
  return text
    .split('\n')
    .map((line) => (line ? `<div>${escapeHtml(line)}</div>` : '<div><br></div>'))
    .join('')
}

export function appendTranscriptionHtml(currentHtml: string, transcript: string): string {
  const spoken = transcript.trim()
  if (!spoken) return currentHtml
  const spokenHtml = textToComposerHtml(spoken)
  return currentHtml.trim() ? `${currentHtml}<div><br></div>${spokenHtml}` : spokenHtml
}
