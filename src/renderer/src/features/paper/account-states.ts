// Pure state logic of the account and voice cards (Design 3b/3e):
// second-click confirmation on disconnect, freshness derivation of the voice
// card and the inline sync error line. Separate from rendering so that
// time windows and text derivation are testable.

/** Window of the second-click confirmation: afterwards the button falls back. */
export const DISCONNECT_CONFIRM_WINDOW_MS = 5000

export type ConfirmEvent = 'arm' | 'esc' | 'blur' | 'timeout' | 'keep' | 'confirm'

/**
 * Transition of the disconnect confirmation: only 'arm' arms it; Esc, blur,
 * expiry of the 5 s window, KEEP and confirming itself disarm it again —
 * regardless of the previous state.
 */
export function confirmAfter(event: ConfirmEvent): boolean {
  return event === 'arm'
}

/** Freshness metadata of a style profile (ai.styleMeta.{accountId}). */
export interface VoiceMeta {
  replies: number
  updatedAt: number
}

/** Tolerant parser — broken JSON or missing fields yield null. */
export function parseVoiceMeta(raw: string | null): VoiceMeta | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { replies?: unknown; updatedAt?: unknown }
    const replies = Number(parsed.replies)
    const updatedAt = Number(parsed.updatedAt)
    if (!Number.isFinite(replies) || replies < 0) return null
    if (!Number.isFinite(updatedAt) || updatedAt <= 0) return null
    return { replies: Math.floor(replies), updatedAt }
  } catch {
    return null
  }
}

export type Freshness = { kind: 'today' } | { kind: 'yesterday' } | { kind: 'days'; days: number }

/**
 * Freshness accurate to the calendar day: "today" ends at midnight, not after
 * 24 h. Timestamps from the future (clock off) count as today.
 */
export function freshnessOf(updatedAt: number, now: number): Freshness {
  const startOfDay = (ts: number): number => {
    const d = new Date(ts)
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }
  const dayDiff = Math.round((startOfDay(now) - startOfDay(updatedAt)) / 86_400_000)
  if (dayDiff <= 0) return { kind: 'today' }
  if (dayDiff === 1) return { kind: 'yesterday' }
  return { kind: 'days', days: dayDiff }
}

/**
 * Electron wraps handler errors in „Error invoking remote method '…':
 * Error: <real message>" — inline only the real message counts (Design 3e:
 * „FAILED — the model refused the request", no transport noise).
 */
export function cleanIpcError(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '')
}

/**
 * Inline error line of an account: the SAVED error text plus „seit
 * 11:42" — an accent word alone is no diagnosis (Design 3b). Without
 * error text null; the caller then falls back to the generic label.
 */
export function syncErrorLine(detail: string | null, since: string | null): string | null {
  const text = detail?.trim()
  if (!text) return null
  return since ? `${text} — ${since}` : text
}
