import { invoke } from '@renderer/lib/ipc'

/**
 * Cached composer draft (New message). Stored as JSON in the
 * settings store — one slot, matching the app's single composer.
 */
export interface ComposeDraft {
  accountId: number | null
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body: string
  html: string
  replyToMessageId?: number
}

const KEY = 'compose.draft'

/** Empty = nothing worth keeping: no recipients, no subject, no own text. */
export function isComposeDraftEmpty(draft: ComposeDraft): boolean {
  return (
    draft.to.length === 0 &&
    draft.cc.length === 0 &&
    draft.bcc.length === 0 &&
    draft.subject.trim() === '' &&
    draft.body.trim() === ''
  )
}

export async function saveComposeDraft(draft: ComposeDraft | null): Promise<void> {
  // settings:set allows max. 100k characters — truncate overlong content instead of failing
  const value = draft
    ? JSON.stringify({
        ...draft,
        body: draft.body.slice(0, 40_000),
        html: draft.html.slice(0, 40_000)
      })
    : ''
  await invoke('settings:set', { key: KEY, value })
}

export async function loadComposeDraft(): Promise<ComposeDraft | null> {
  const { value } = await invoke('settings:get', { key: KEY })
  if (!value) return null
  try {
    const raw = JSON.parse(value) as Partial<ComposeDraft>
    if (!Array.isArray(raw.to) || !Array.isArray(raw.cc)) return null
    const strings = (list: unknown): string[] =>
      Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
    return {
      accountId: typeof raw.accountId === 'number' ? raw.accountId : null,
      to: strings(raw.to),
      cc: strings(raw.cc),
      bcc: strings(raw.bcc),
      subject: typeof raw.subject === 'string' ? raw.subject : '',
      body: typeof raw.body === 'string' ? raw.body : '',
      html: typeof raw.html === 'string' ? raw.html : '',
      replyToMessageId: typeof raw.replyToMessageId === 'number' ? raw.replyToMessageId : undefined
    }
  } catch {
    return null
  }
}
