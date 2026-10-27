import { create } from 'zustand'
import type { OwlMessage, OwlSource } from '@shared/types'
import type { PushPayload } from '@shared/ipc-contract'
import type { SemanticSearchHit } from '@renderer/features/search/useSemanticSearch'

// State of the Owl view (search + ask in one input field).
// The state machine from the design handoff:
//   empty → typing(hits) → asking(streaming) → conversation(idle) → typing(follow-up)
// The IPC calls (ai:chat, owl:*) live in the view or in queries/owl.ts —
// here only pure, testable transitions.

/** Message in the active history; pending marks the answer still streaming. */
export interface OwlDraftMessage extends OwlMessage {
  pending?: boolean
}

export type OwlPhase = 'empty' | 'typing' | 'asking' | 'conversation'

interface OwlState {
  /** Draft text in the input field (search and question at once). */
  query: string
  setQuery: (query: string) => void
  /** Opened (persisted) conversation — null before the first save. */
  selConversationId: number | null
  /** Active history in the sheet. */
  messages: OwlDraftMessage[]
  /** Is an answer currently running? */
  asking: boolean
  chatId: string | null
  /** Inline error below the input field — never as a toast. */
  askError: string | null
  /** Live hits at question time: enrich the SOURCES card. */
  contextHits: SemanticSearchHit[]
  /** Counter: focus the input field as soon as the view is up (again). */
  pendingFocus: boolean
  requestFocus: () => void
  clearFocusRequest: () => void
  /**
   * Ask a question: appends the user turn + streaming answer and returns
   * the history for ai:chat (history BEFORE this question). null if a question
   * is already running or the question is empty.
   */
  beginAsk: (
    question: string,
    hits?: SemanticSearchHit[]
  ) => { history: Array<{ role: 'user' | 'assistant'; content: string }> } | null
  setChatId: (chatId: string) => void
  /** Apply a streaming chunk; foreign chatIds are ignored. */
  applyChunk: (payload: PushPayload<'ai:chatChunk'>) => void
  /** Abort/error: question back into the input field, nothing is saved. */
  failAsk: (message: string) => void
  /** After owl:save: adopt the id of the persisted conversation. */
  setSaved: (id: number) => void
  /** Load a persisted conversation into the sheet. */
  openConversation: (conversation: { id: number; messages: OwlMessage[] }) => void
  /** n / NEW QUESTION: back to the empty state. */
  newQuestion: () => void
}

/** Derivation of the state machine phase — the view renders exclusively from it. */
export function owlPhase(state: {
  query: string
  asking: boolean
  messages: OwlDraftMessage[]
}): OwlPhase {
  if (state.asking) return 'asking'
  if (state.query.trim()) return 'typing'
  return state.messages.length > 0 ? 'conversation' : 'empty'
}

/** history for ai:chat: completed turns, capped at the contract limit. */
export function historyForAsk(
  messages: OwlDraftMessage[]
): Array<{ role: 'user' | 'assistant'; content: string }> {
  return messages
    .filter((m) => !m.pending && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, 6000) }))
    .slice(-12)
}

/** Enrich sources from the push with the live hits at question time. */
export function enrichSources(
  sources: NonNullable<PushPayload<'ai:chatChunk'>['sources']>,
  hits: SemanticSearchHit[]
): OwlSource[] {
  return sources.map((source) => {
    const hit = hits.find((h) => h.threadKey === source.threadKey)
    return hit
      ? {
          ...source,
          subject: source.subject ?? hit.subject,
          accountName: hit.accountName,
          mailbox: hit.mailbox,
          date: hit.date
        }
      : source
  })
}

export const useOwl = create<OwlState>((set, get) => ({
  query: '',
  setQuery: (query) => set({ query, askError: null }),
  selConversationId: null,
  messages: [],
  asking: false,
  chatId: null,
  askError: null,
  contextHits: [],
  pendingFocus: false,
  requestFocus: () => set({ pendingFocus: true }),
  clearFocusRequest: () => set({ pendingFocus: false }),

  beginAsk: (question, hits = []) => {
    const state = get()
    const q = question.trim()
    if (!q || state.asking) return null
    const history = historyForAsk(state.messages)
    set({
      messages: [
        ...state.messages,
        { role: 'user', content: q, at: Date.now() },
        { role: 'assistant', content: '', at: Date.now(), pending: true }
      ],
      query: '',
      asking: true,
      chatId: null,
      askError: null,
      contextHits: hits
    })
    return { history }
  },

  setChatId: (chatId) => set({ chatId }),

  applyChunk: (payload) => {
    const state = get()
    if (!state.chatId || payload.chatId !== state.chatId) return
    if (payload.error) {
      get().failAsk(payload.error)
      return
    }
    const messages = [...state.messages]
    const last = messages[messages.length - 1]
    if (!last || last.role !== 'assistant' || !last.pending) return
    messages[messages.length - 1] = {
      ...last,
      content: last.content + payload.chunk,
      sources: payload.sources ? enrichSources(payload.sources, state.contextHits) : last.sources,
      pending: !payload.done
    }
    set({ messages, ...(payload.done ? { asking: false, chatId: null } : {}) })
  },

  failAsk: (message) => {
    // Aborted questions vanish without a trace: question back into the field,
    // history as before asking — such a thing is never saved.
    const state = get()
    const messages = [...state.messages]
    const pendingIndex = messages.findLastIndex((m) => m.role === 'assistant' && m.pending)
    let question = ''
    if (pendingIndex !== -1) {
      messages.splice(pendingIndex, 1)
      const userIndex = pendingIndex - 1
      if (messages[userIndex]?.role === 'user') {
        question = messages[userIndex].content
        messages.splice(userIndex, 1)
      }
    }
    set({
      messages,
      asking: false,
      chatId: null,
      askError: message,
      query: state.query || question
    })
  },

  setSaved: (id) => set({ selConversationId: id }),

  openConversation: ({ id, messages }) =>
    set({
      selConversationId: id,
      messages,
      query: '',
      asking: false,
      chatId: null,
      askError: null,
      contextHits: []
    }),

  newQuestion: () =>
    set({
      selConversationId: null,
      messages: [],
      query: '',
      asking: false,
      chatId: null,
      askError: null,
      contextHits: []
    })
}))
