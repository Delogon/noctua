import { create } from 'zustand'

// One toast queue for everything (Design 1c): exactly one visible toast,
// priority countdown > error > action > info. The pure queue logic
// (pushToast/advanceQueue/dismissToast/…) works with a passed-in
// clock and is thus unit-testable without timers; the Zustand store below
// only takes care of Date.now() and the timeouts.

export type ToastKind = 'info' | 'action' | 'countdown' | 'error'

export interface ToastAction {
  label: string
  /** Key chip in the button (e.g. "Z", "⌘Z") — the key acts identically. */
  kbd?: string
  run: () => void
}

export interface Toast {
  id: number
  kind: ToastKind
  text: string
  action?: ToastAction
  /** Text comes from the owl (model) — the bar shows eyes instead of a square. */
  owl?: boolean
  /** Show the CLOSE button; the toast then lives until clicked. */
  dismiss?: boolean
  createdAt: number
  /** Display duration for infos; translated into expiresAt when shown. */
  durationMs?: number
  /** Absolute expiry: for action the end of the offer, for info the end of display. */
  expiresAt?: number
  countdown?: {
    /** The undo window runs until here (= sendAt). */
    until: number
    /** Live text with remaining seconds (translated at render time). */
    textFor: (secondsLeft: number) => string
    /** Info text after the countdown expires (auto-swap, same id). */
    doneText: string
  }
}

/** Display duration of an info toast (the old PaperToast timing). */
export const INFO_TOAST_MS = 3600
/** Displaced infos only come back as long as they are younger than 8 s. */
export const RESHOW_FRESH_MS = 8000

const PRIORITY: Record<ToastKind, number> = { countdown: 3, error: 2, action: 1, info: 0 }

export interface ToastQueueState {
  current: Toast | null
  queue: Toast[]
}

/** May a waiting toast (still) be shown? */
export function toastAlive(toast: Toast, now: number): boolean {
  if (toast.kind === 'error' || toast.dismiss) return true
  if (toast.kind === 'countdown') return true
  // action lives exactly as long as its offer (absolute window)
  if (toast.kind === 'action') return toast.expiresAt === undefined || now < toast.expiresAt
  return now - toast.createdAt < RESHOW_FRESH_MS
}

/** Countdown → its done info text: same id, the action expires with the window. */
export function swapToDone(toast: Toast, now: number): Toast {
  return {
    id: toast.id,
    kind: 'info',
    text: toast.countdown?.doneText ?? toast.text,
    createdAt: now,
    expiresAt: now + INFO_TOAST_MS
  }
}

/** Concretize when showing: infos get their expiry date (fresh, even
 *  after displacement), an already expired countdown gets its done text. */
function materialize(toast: Toast, now: number): Toast {
  if (toast.countdown && now >= toast.countdown.until) return swapToDone(toast, now)
  if (toast.kind === 'info' && !toast.dismiss) {
    return { ...toast, expiresAt: now + (toast.durationMs ?? INFO_TOAST_MS) }
  }
  return toast
}

/** New toast: displaces equal or lower rank, otherwise queues at the back. */
export function pushToast(state: ToastQueueState, toast: Toast, now: number): ToastQueueState {
  const cur = state.current
  if (!cur) return { current: materialize(toast, now), queue: state.queue }
  if (PRIORITY[toast.kind] >= PRIORITY[cur.kind]) {
    // The displaced one waits at the front and may come back while it lives
    return { current: materialize(toast, now), queue: [cur, ...state.queue] }
  }
  return { current: cur, queue: [...state.queue, toast] }
}

/** Clear the visible toast and show the best still-living waiting one. */
export function advanceQueue(state: ToastQueueState, now: number): ToastQueueState {
  const candidates = state.queue.filter((t) => toastAlive(t, now))
  if (candidates.length === 0) return { current: null, queue: [] }
  let best = candidates[0]
  for (const t of candidates) if (PRIORITY[t.kind] > PRIORITY[best.kind]) best = t
  return { current: materialize(best, now), queue: candidates.filter((t) => t !== best) }
}

/** Remove specifically — visible or waiting (e.g. countdown after cancel). */
export function dismissToast(state: ToastQueueState, id: number, now: number): ToastQueueState {
  if (state.current?.id === id) return advanceQueue(state, now)
  return { current: state.current, queue: state.queue.filter((t) => t.id !== id) }
}

interface ToastStore extends ToastQueueState {
  push: (toast: Omit<Toast, 'id' | 'createdAt'>) => number
  dismiss: (id: number) => void
  /** Run the action button (or its key); the toast expires in the process. */
  runAction: (id: number) => void
  /** Countdown end of the visible toast: switch to the done text. */
  swapDone: () => void
  /** Clear the visible toast and show the next one (timer path). */
  advance: () => void
}

let nextId = 1
let timer: ReturnType<typeof setTimeout> | null = null

/** Set the timer to the next deadline of the visible toast. */
function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = null
  const cur = useToast.getState().current
  if (!cur) return
  const deadline = cur.countdown ? cur.countdown.until : cur.expiresAt
  if (deadline === undefined) return
  const id = cur.id
  const wasCountdown = Boolean(cur.countdown)
  timer = setTimeout(
    () => {
      const state = useToast.getState()
      if (state.current?.id !== id) return
      if (wasCountdown && state.current.countdown) state.swapDone()
      else state.advance()
    },
    Math.max(0, deadline - Date.now())
  )
}

export const useToast = create<ToastStore>((set, get) => ({
  current: null,
  queue: [],
  push: (partial) => {
    const now = Date.now()
    const entry: Toast = { ...partial, id: nextId++, createdAt: now }
    set((s) => pushToast(s, entry, now))
    schedule()
    return entry.id
  },
  dismiss: (id) => {
    set((s) => dismissToast(s, id, Date.now()))
    schedule()
  },
  runAction: (id) => {
    const s = get()
    const target = s.current?.id === id ? s.current : s.queue.find((t) => t.id === id)
    if (!target?.action) return
    get().dismiss(id)
    target.action.run()
  },
  swapDone: () => {
    set((s) => (s.current ? { current: swapToDone(s.current, Date.now()) } : {}))
    schedule()
  },
  advance: () => {
    set((s) => advanceQueue(s, Date.now()))
    schedule()
  }
}))

// Public API (C1): toast.info / toast.action / toast.countdown / toast.error
export const toast = {
  info(
    text: string,
    opts: { action?: ToastAction; dismiss?: boolean; durationMs?: number; owl?: boolean } = {}
  ): number {
    return useToast.getState().push({ kind: 'info', text, ...opts })
  },
  /** Lives exactly as long as its offer (windowMs from now, absolute). */
  action(
    text: string,
    action: ToastAction,
    windowMs: number,
    opts: { owl?: boolean } = {}
  ): number {
    return useToast
      .getState()
      .push({ kind: 'action', text, action, expiresAt: Date.now() + windowMs, ...opts })
  },
  countdown(opts: {
    until: number
    textFor: (secondsLeft: number) => string
    doneText: string
    action: ToastAction
  }): number {
    const secondsLeft = Math.max(0, Math.ceil((opts.until - Date.now()) / 1000))
    return useToast.getState().push({
      kind: 'countdown',
      text: opts.textFor(secondsLeft),
      action: opts.action,
      countdown: { until: opts.until, textFor: opts.textFor, doneText: opts.doneText }
    })
  },
  /** Stays until closed. */
  error(text: string, opts: { action?: ToastAction } = {}): number {
    return useToast.getState().push({ kind: 'error', text, action: opts.action, dismiss: true })
  },
  dismiss(id: number): void {
    useToast.getState().dismiss(id)
  }
}
