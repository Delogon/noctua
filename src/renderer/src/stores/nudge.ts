import { create } from 'zustand'

// State of the nudge composer of the Waiting view: the same state machine as the
// reply composer (stores/paper, comp), only bound to a followup (messageId) instead
// of a thread. Separate store so a running nudge dictation does not
// touch the inbox draft — and vice versa.

export type NudgeMode = 'idle' | 'listening' | 'transcribing' | 'drafting' | 'ready' | 'sending'
export type NudgeResultKind = 'transcribed' | 'generated'
export type NudgeErrorKind = 'transcription' | 'generation' | 'send'

export interface NudgeCompState {
  /** Followup (messages.id of the own sent mail) the buffer belongs to. */
  messageId: number | null
  mode: NudgeMode
  secs: number
  processingSeconds: number
  text: string
  html: string
  originalText: string
  originalHtml: string
  resultKind: NudgeResultKind | null
  error: string | null
  errorKind: NudgeErrorKind | null
  draftId: string | null
  generationStarted: boolean
}

const NUDGE_IDLE: NudgeCompState = {
  messageId: null,
  mode: 'idle',
  secs: 0,
  processingSeconds: 0,
  text: '',
  html: '',
  originalText: '',
  originalHtml: '',
  resultKind: null,
  error: null,
  errorKind: null,
  draftId: null,
  generationStarted: false
}

interface NudgeStore extends NudgeCompState {
  setNudge: (patch: Partial<NudgeCompState>) => void
  resetNudge: (messageId?: number | null) => void
}

export const useNudge = create<NudgeStore>((set) => ({
  ...NUDGE_IDLE,
  setNudge: (patch) => set(patch),
  resetNudge: (messageId = null) => set({ ...NUDGE_IDLE, messageId })
}))
