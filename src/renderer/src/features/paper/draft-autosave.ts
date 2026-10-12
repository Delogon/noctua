import { invoke } from '@renderer/lib/ipc'
import { usePaper } from '@renderer/stores/paper'

/**
 * Persists the composer buffer as a draft per thread (M37).
 *
 * The composer (`comp` in the paper store) only ever holds ONE draft in
 * memory; every thread switch or resetComp() used to discard it. This
 * module listens centrally on the store: typing and dictation are written
 * debounced to the drafts table, and when switching away the latest state is
 * saved immediately — regardless of which code path triggers the reset.
 */

const DEBOUNCE_MS = 700

let timer: ReturnType<typeof setTimeout> | null = null
let pending: { threadKey: string; text: string; html: string } | null = null
let notifyChanged: (() => void) | null = null

function flush(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const p = pending
  pending = null
  if (!p) return
  void invoke('drafts:save', p).then(() => notifyChanged?.())
}

function schedule(threadKey: string, text: string, html: string): void {
  pending = { threadKey, text, html }
  if (timer) clearTimeout(timer)
  timer = setTimeout(flush, DEBOUNCE_MS)
}

/**
 * Removes a thread's saved draft and discards any still pending save so it
 * does not revive it (send, discard, delete from the owl rail).
 */
export function removeDraft(threadKey: string): void {
  if (pending?.threadKey === threadKey) {
    pending = null
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }
  void invoke('drafts:delete', { threadKey }).then(() => notifyChanged?.())
}

/**
 * Wire up at app start; onChanged invalidates the drafts query.
 * Returns the unsubscribe function (StrictMode runs effects twice).
 */
export function initDraftAutosave(onChanged: () => void): () => void {
  notifyChanged = onChanged
  return usePaper.subscribe((state, prev) => {
    const c = state.comp
    const p = prev.comp
    if (c === p) return

    // Thread switch or reset: save the previous thread's latest state right
    // away — except when sending, where the send path deletes the draft.
    if (p.threadKey && p.threadKey !== c.threadKey && p.mode !== 'sending') {
      if (p.text.trim()) schedule(p.threadKey, p.text, p.html)
      flush()
    }

    if (!c.threadKey || c.mode === 'sending') return
    if (c.threadKey === p.threadKey && c.text === p.text && c.html === p.html) return

    if (c.text.trim()) {
      schedule(c.threadKey, c.text, c.html)
    } else if (c.threadKey === p.threadKey && p.text.trim()) {
      // The text was deliberately cleared → remove the saved draft as well.
      removeDraft(c.threadKey)
    }
  })
}
