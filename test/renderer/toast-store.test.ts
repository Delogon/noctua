import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  INFO_TOAST_MS,
  RESHOW_FRESH_MS,
  advanceQueue,
  dismissToast,
  pushToast,
  toast,
  toastAlive,
  useToast,
  type Toast,
  type ToastKind,
  type ToastQueueState
} from '@renderer/stores/toast'
import { usePaper } from '@renderer/stores/paper'

const NOW = new Date('2026-07-15T12:00:00').getTime()

let testId = 1000
function mk(kind: ToastKind, over: Partial<Toast> = {}): Toast {
  return { id: ++testId, kind, text: kind, createdAt: NOW, ...over }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  useToast.setState({ current: null, queue: [] })
})

afterEach(() => vi.useRealTimers())

describe('Toast-Queue — reine Regeln (pushToast/advanceQueue)', () => {
  const empty: ToastQueueState = { current: null, queue: [] }

  it('Priorität: countdown verdrängt error verdrängt action verdrängt info', () => {
    let s = pushToast(empty, mk('info'), NOW)
    s = pushToast(s, mk('action', { expiresAt: NOW + 5000 }), NOW)
    expect(s.current?.kind).toBe('action')
    s = pushToast(s, mk('error'), NOW)
    expect(s.current?.kind).toBe('error')
    s = pushToast(s, mk('countdown', { countdown: cd() }), NOW)
    expect(s.current?.kind).toBe('countdown')
    // all displaced ones wait
    expect(s.queue.map((t) => t.kind)).toEqual(['error', 'action', 'info'])
  })

  it('niederrangige Ankunft verdrängt nicht, sondern stellt sich an', () => {
    let s = pushToast(empty, mk('error'), NOW)
    s = pushToast(s, mk('info'), NOW)
    expect(s.current?.kind).toBe('error')
    expect(s.queue.map((t) => t.kind)).toEqual(['info'])
  })

  it('gleichrangige Ankunft verdrängt (neue Info ersetzt die sichtbare)', () => {
    let s = pushToast(empty, mk('info', { text: 'alt' }), NOW)
    s = pushToast(s, mk('info', { text: 'neu' }), NOW)
    expect(s.current?.text).toBe('neu')
  })

  it('verdrängte Info kommt zurück, solange sie jünger als 8s ist', () => {
    let s = pushToast(empty, mk('info', { text: 'gist' }), NOW)
    s = pushToast(s, mk('error'), NOW + 1000)
    // Error closed after 5s → info is 5s old and still fresh
    s = dismissToast(s, s.current!.id, NOW + 5000)
    expect(s.current?.text).toBe('gist')
    // fresh expiry from when it is shown again
    expect(s.current?.expiresAt).toBe(NOW + 5000 + INFO_TOAST_MS)
  })

  it('verdrängte Info verfällt nach 8s still', () => {
    let s = pushToast(empty, mk('info', { text: 'gist' }), NOW)
    s = pushToast(s, mk('error'), NOW + 1000)
    s = dismissToast(s, s.current!.id, NOW + RESHOW_FRESH_MS)
    expect(s.current).toBeNull()
    expect(s.queue).toHaveLength(0)
  })

  it('action lebt exakt so lange wie ihr Angebot — auch nach Verdrängung', () => {
    const offer = mk('action', { expiresAt: NOW + 5000 })
    let s = pushToast(empty, offer, NOW)
    s = pushToast(s, mk('error'), NOW + 1000)
    // Within the window the offer comes back …
    expect(toastAlive(offer, NOW + 4999)).toBe(true)
    const back = dismissToast(s, s.current!.id, NOW + 4000)
    expect(back.current?.id).toBe(offer.id)
    // … after expiry it does not
    expect(toastAlive(offer, NOW + 5000)).toBe(false)
    const gone = dismissToast(s, s.current!.id, NOW + 5000)
    expect(gone.current).toBeNull()
  })

  it('error bleibt beliebig lange lebendig (bis Dismiss)', () => {
    const err = mk('error')
    expect(toastAlive(err, NOW + 3_600_000)).toBe(true)
  })

  it('persistente Info (dismiss: true) bekommt kein Ablaufdatum und bleibt frisch', () => {
    const persistent = mk('info', { dismiss: true })
    const s = pushToast(empty, persistent, NOW)
    expect(s.current?.expiresAt).toBeUndefined()
    expect(toastAlive(persistent, NOW + 3_600_000)).toBe(true)
  })

  it('advanceQueue zeigt die beste Wartende und filtert Tote heraus', () => {
    const state: ToastQueueState = {
      current: null,
      queue: [
        mk('info', { createdAt: NOW - RESHOW_FRESH_MS }), // too old
        mk('action', { expiresAt: NOW + 1000 }),
        mk('error')
      ]
    }
    const s = advanceQueue(state, NOW)
    expect(s.current?.kind).toBe('error')
    expect(s.queue.map((t) => t.kind)).toEqual(['action'])
  })

  function cd(until = NOW + 5000): Toast['countdown'] {
    return { until, textFor: (n) => `in ${n}s`, doneText: 'raus' }
  }
})

describe('Toast-Store — Timer und Auto-Swap', () => {
  it('info verschwindet nach 3600ms', () => {
    toast.info('kurz')
    expect(useToast.getState().current?.text).toBe('kurz')
    vi.advanceTimersByTime(INFO_TOAST_MS)
    expect(useToast.getState().current).toBeNull()
  })

  it('action stirbt am Fensterende (5s), nicht bei 3.6s', () => {
    toast.action('Abgelegt.', { label: 'Rückgängig', kbd: 'Z', run: () => {} }, 5000)
    vi.advanceTimersByTime(INFO_TOAST_MS)
    expect(useToast.getState().current?.kind).toBe('action')
    vi.advanceTimersByTime(5000 - INFO_TOAST_MS)
    expect(useToast.getState().current).toBeNull()
  })

  it('countdown hält bis until und wechselt dann auf seinen Done-Text (gleiche id)', () => {
    const id = toast.countdown({
      until: NOW + 4000,
      textFor: (n) => `Geht in ${n}s raus`,
      doneText: 'Geht gerade raus…',
      action: { label: 'Rückgängig', kbd: '⌘Z', run: () => {} }
    })
    vi.advanceTimersByTime(3999)
    expect(useToast.getState().current?.kind).toBe('countdown')
    vi.advanceTimersByTime(1)
    const swapped = useToast.getState().current
    expect(swapped?.id).toBe(id)
    expect(swapped?.kind).toBe('info')
    expect(swapped?.text).toBe('Geht gerade raus…')
    // the action expires with the window
    expect(swapped?.action).toBeUndefined()
    vi.advanceTimersByTime(INFO_TOAST_MS)
    expect(useToast.getState().current).toBeNull()
  })

  it('error bleibt stehen, bis er geschlossen wird', () => {
    const id = toast.error('Senden fehlgeschlagen')
    vi.advanceTimersByTime(60_000)
    expect(useToast.getState().current?.kind).toBe('error')
    toast.dismiss(id)
    expect(useToast.getState().current).toBeNull()
  })

  it('Preemption + Re-Show über die echten Timer: Info wartet den Countdown ab', () => {
    toast.info('gist')
    toast.countdown({
      until: NOW + 4000,
      textFor: (n) => `in ${n}s`,
      doneText: 'raus',
      action: { label: 'Rückgängig', run: () => {} }
    })
    expect(useToast.getState().current?.kind).toBe('countdown')
    // Countdown is cancelled → the fresh info (4s old) comes back
    vi.advanceTimersByTime(4000)
    toast.dismiss(useToast.getState().current!.id)
    expect(useToast.getState().current?.text).toBe('gist')
  })

  it('runAction führt die Aktion aus und räumt die Toast ab', () => {
    const run = vi.fn()
    const id = toast.action('Abgelegt.', { label: 'Rückgängig', kbd: 'Z', run }, 5000)
    useToast.getState().runAction(id)
    expect(run).toHaveBeenCalledOnce()
    expect(useToast.getState().current).toBeNull()
  })

  it('dismiss entfernt auch Wartende gezielt (Cancel eines verdrängten Countdowns)', () => {
    const id = toast.countdown({
      until: NOW + 10_000,
      textFor: (n) => `in ${n}s`,
      doneText: 'raus',
      action: { label: 'Rückgängig', run: () => {} }
    })
    toast.countdown({
      until: NOW + 12_000,
      textFor: (n) => `in ${n}s`,
      doneText: 'raus',
      action: { label: 'Rückgängig', run: () => {} }
    })
    expect(useToast.getState().queue.some((t) => t.id === id)).toBe(true)
    toast.dismiss(id)
    expect(useToast.getState().queue.some((t) => t.id === id)).toBe(false)
    expect(useToast.getState().current).not.toBeNull()
  })
})

describe('toastNow-Shim — Call-Sites unverändert', () => {
  it('leitet auf toast.info um (Standarddauer 3600ms)', () => {
    usePaper.getState().toastNow('Alle Postfächer werden abgeglichen…')
    const current = useToast.getState().current
    expect(current?.kind).toBe('info')
    expect(current?.text).toBe('Alle Postfächer werden abgeglichen…')
    vi.advanceTimersByTime(INFO_TOAST_MS)
    expect(useToast.getState().current).toBeNull()
  })

  it('respektiert eine explizite Dauer', () => {
    usePaper.getState().toastNow('laenger', 5000)
    vi.advanceTimersByTime(INFO_TOAST_MS)
    expect(useToast.getState().current?.text).toBe('laenger')
    vi.advanceTimersByTime(5000 - INFO_TOAST_MS)
    expect(useToast.getState().current).toBeNull()
  })
})
