import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { usePaper } from '@renderer/stores/paper'
import { useUiStore } from '@renderer/stores/ui'
import { toast, useToast } from '@renderer/stores/toast'

/**
 * Nudge safety: in the waiting view only ⌘↵ may send — an
 * unfocused Enter no longer sends a real mail.
 */

type Handler = (event: KeyboardEvent) => void

function fakeKey(over: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    preventDefault: vi.fn(),
    ...over
  } as unknown as KeyboardEvent
}

describe('Keymap — Wartet-Ansicht', () => {
  let handler: Handler
  const dispatched: Array<{ type: string; detail: unknown }> = []

  beforeEach(async () => {
    dispatched.length = 0
    vi.stubGlobal('window', {
      noctua: { invoke: vi.fn().mockResolvedValue({}), on: vi.fn() },
      addEventListener: vi.fn((_type: string, fn: Handler) => {
        handler = fn
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: CustomEvent) => {
        dispatched.push({ type: event.type, detail: event.detail })
        return true
      })
    })
    const { installPaperKeymap } = await import('@renderer/keyboard/keymap')
    installPaperKeymap(() => [])
    usePaper.setState({ view: 'waiting', paletteOpen: false, helpOpen: false, onboarding: false })
    usePaper.getState().resetComp()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('Plain Enter sendet keinen Stups', () => {
    handler(fakeKey({ key: 'Enter' }))
    expect(dispatched.filter((d) => d.type === 'paper:waiting')).toHaveLength(0)
  })

  it('⌘Enter sendet den Stups', () => {
    handler(fakeKey({ key: 'Enter', metaKey: true }))
    expect(dispatched).toContainEqual({ type: 'paper:waiting', detail: 'enter' })
  })

  it('⌘D startet das Stups-Diktat in der Wartet-Ansicht', () => {
    handler(fakeKey({ key: 'd', metaKey: true }))
    expect(dispatched).toContainEqual({ type: 'paper:waiting', detail: 'dictate' })
  })

  it('⌘J formuliert den Stups neu', () => {
    handler(fakeKey({ key: 'j', metaKey: true }))
    expect(dispatched).toContainEqual({ type: 'paper:waiting', detail: 'elaborate' })
  })

  it('Esc erreicht den Stups-Composer (Abbruch von Diktat/Formulieren)', () => {
    handler(fakeKey({ key: 'Escape' }))
    expect(dispatched).toContainEqual({ type: 'paper:waiting', detail: 'escape' })
  })

  it('⌘D/⌘J im Posteingang bleiben beim Reply-Composer', () => {
    usePaper.setState({ view: 'inbox', mbox: 'inbox' })
    usePaper.getState().setComp({ text: 'Entwurf' })
    handler(fakeKey({ key: 'd', metaKey: true }))
    handler(fakeKey({ key: 'j', metaKey: true }))
    expect(dispatched.filter((d) => d.type === 'paper:waiting')).toHaveLength(0)
    expect(dispatched).toContainEqual({ type: 'paper:mail', detail: 'dictate' })
    expect(dispatched).toContainEqual({ type: 'paper:mail', detail: 'elaborate' })
  })
})

describe('Keymap — Antworten im Posteingang (r/a)', () => {
  let handler: Handler
  const dispatched: Array<{ type: string; detail: unknown }> = []

  beforeEach(async () => {
    dispatched.length = 0
    vi.stubGlobal('window', {
      noctua: { invoke: vi.fn().mockResolvedValue({}), on: vi.fn() },
      addEventListener: vi.fn((_type: string, fn: Handler) => {
        handler = fn
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: CustomEvent) => {
        dispatched.push({ type: event.type, detail: event.detail })
        return true
      })
    })
    const { installPaperKeymap } = await import('@renderer/keyboard/keymap')
    installPaperKeymap(() => [])
    usePaper.setState({
      view: 'inbox',
      mbox: 'inbox',
      paletteOpen: false,
      helpOpen: false,
      onboarding: false
    })
    usePaper.getState().resetComp()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('a löst Allen-antworten aus (paper:mail replyAll)', () => {
    handler(fakeKey({ key: 'a' }))
    expect(dispatched).toContainEqual({ type: 'paper:mail', detail: 'replyAll' })
  })

  it('r bleibt die normale Antwort', () => {
    handler(fakeKey({ key: 'r' }))
    expect(dispatched).toContainEqual({ type: 'paper:mail', detail: 'reply' })
    expect(dispatched.filter((d) => d.detail === 'replyAll')).toHaveLength(0)
  })

  it('a tut nichts außerhalb des Posteingangs (GESENDET/SPAM, andere Views)', () => {
    usePaper.setState({ mbox: 'sent' })
    handler(fakeKey({ key: 'a' }))
    usePaper.setState({ mbox: 'inbox', view: 'tasks' })
    handler(fakeKey({ key: 'a' }))
    expect(dispatched.filter((d) => d.detail === 'replyAll')).toHaveLength(0)
  })

  it('a beim Tippen im Composer bleibt Texteingabe', () => {
    const editor = {
      tagName: 'DIV',
      isContentEditable: true,
      closest: () => ({})
    } as unknown as HTMLElement
    handler(fakeKey({ key: 'a', target: editor }))
    expect(dispatched.filter((d) => d.detail === 'replyAll')).toHaveLength(0)
  })
})

describe('Keymap — Esc in der Compose-Ansicht', () => {
  let handler: Handler
  const dispatched: Array<{ type: string; detail: unknown }> = []

  beforeEach(async () => {
    dispatched.length = 0
    vi.stubGlobal('window', {
      noctua: { invoke: vi.fn().mockResolvedValue({}), on: vi.fn() },
      addEventListener: vi.fn((_type: string, fn: Handler) => {
        handler = fn
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: CustomEvent) => {
        dispatched.push({ type: event.type, detail: event.detail })
        return true
      })
    })
    const { installPaperKeymap } = await import('@renderer/keyboard/keymap')
    installPaperKeymap(() => [])
    usePaper.setState({ view: 'compose', paletteOpen: false, helpOpen: false, onboarding: false })
    usePaper.getState().resetComp()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('Esc legt den Entwurf ab (paper:compose escape)', () => {
    handler(fakeKey({ key: 'Escape' }))
    expect(dispatched).toContainEqual({ type: 'paper:compose', detail: 'escape' })
  })

  it('Esc gehört zuerst der offenen Palette', () => {
    usePaper.setState({ paletteOpen: true })
    handler(fakeKey({ key: 'Escape' }))
    expect(dispatched.filter((d) => d.type === 'paper:compose')).toHaveLength(0)
    expect(usePaper.getState().paletteOpen).toBe(false)
  })

  it('außerhalb der Compose-Ansicht wird kein Entwurf abgelegt', () => {
    usePaper.setState({ view: 'inbox' })
    handler(fakeKey({ key: 'Escape' }))
    expect(dispatched.filter((d) => d.type === 'paper:compose')).toHaveLength(0)
  })
})

describe('Keymap — Z/⌘Z-Routing für die Toast-Queue', () => {
  let handler: Handler
  const dispatched: Array<{ type: string; detail: unknown }> = []

  beforeEach(async () => {
    dispatched.length = 0
    vi.stubGlobal('window', {
      noctua: { invoke: vi.fn().mockResolvedValue({}), on: vi.fn() },
      addEventListener: vi.fn((_type: string, fn: Handler) => {
        handler = fn
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: CustomEvent) => {
        dispatched.push({ type: event.type, detail: event.detail })
        return true
      })
    })
    const { installPaperKeymap } = await import('@renderer/keyboard/keymap')
    installPaperKeymap(() => [])
    usePaper.setState({ view: 'inbox', paletteOpen: false, helpOpen: false, onboarding: false })
    usePaper.getState().resetComp()
    useToast.setState({ current: null, queue: [] })
  })

  afterEach(() => vi.unstubAllGlobals())

  function showCountdown(run: () => void): void {
    toast.countdown({
      until: Date.now() + 10_000,
      textFor: (n) => `in ${n}s`,
      doneText: 'raus',
      action: { label: 'Rückgängig', kbd: '⌘Z', run }
    })
  }

  it('⌘Z storniert nur bei sichtbarem Countdown', () => {
    const run = vi.fn()
    showCountdown(run)
    const event = fakeKey({ key: 'z', metaKey: true })
    handler(event)
    expect(run).toHaveBeenCalledOnce()
    expect(event.preventDefault).toHaveBeenCalled()
    // the countdown toast is thereby cleared
    expect(useToast.getState().current).toBeNull()
  })

  it('⌘Z bleibt beim Tippen das native Undo', () => {
    const run = vi.fn()
    showCountdown(run)
    const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null }
    const event = fakeKey({ key: 'z', metaKey: true, target: input as unknown as EventTarget })
    handler(event)
    expect(run).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('⌘Z ohne Countdown tut nichts (kein preventDefault)', () => {
    const event = fakeKey({ key: 'z', metaKey: true })
    handler(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('⌘Z greift nicht, wenn nur eine Info sichtbar ist', () => {
    toast.info('gist')
    const event = fakeKey({ key: 'z', metaKey: true })
    handler(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(useToast.getState().current?.text).toBe('gist')
  })

  it('blankes z läuft weiter über die Mail-Undo-Route (Action-Toast-Taste)', () => {
    handler(fakeKey({ key: 'z' }))
    expect(dispatched).toContainEqual({ type: 'paper:mail', detail: 'undo' })
  })
})

describe('Keymap — Kategorie-Override (Taste l, Design 3d)', () => {
  let handler: Handler
  const dispatched: Array<{ type: string; detail: unknown }> = []

  beforeEach(async () => {
    dispatched.length = 0
    vi.stubGlobal('window', {
      noctua: { invoke: vi.fn().mockResolvedValue({}), on: vi.fn() },
      addEventListener: vi.fn((_type: string, fn: Handler) => {
        handler = fn
      }),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: CustomEvent) => {
        dispatched.push({ type: event.type, detail: event.detail })
        return true
      })
    })
    const { installPaperKeymap } = await import('@renderer/keyboard/keymap')
    installPaperKeymap(() => [11, 22])
    usePaper.setState({
      view: 'inbox',
      mbox: 'inbox',
      filter: null,
      paletteOpen: false,
      helpOpen: false,
      onboarding: false
    })
    usePaper.getState().resetComp()
    useUiStore.setState({ overrideMenuOpen: false })
  })

  afterEach(() => vi.unstubAllGlobals())

  it('l im Posteingang öffnet das Menü (paper:mail → override)', () => {
    handler(fakeKey({ key: 'l' }))
    expect(dispatched).toContainEqual({ type: 'paper:mail', detail: 'override' })
  })

  it('l greift nicht beim Tippen (Typing-Guard)', () => {
    const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null }
    handler(fakeKey({ key: 'l', target: input as unknown as EventTarget }))
    expect(dispatched.filter((d) => d.detail === 'override')).toHaveLength(0)
  })

  it('l außerhalb des Posteingangs tut nichts', () => {
    usePaper.setState({ view: 'waiting' })
    handler(fakeKey({ key: 'l' }))
    expect(dispatched.filter((d) => d.detail === 'override')).toHaveLength(0)

    usePaper.setState({ view: 'inbox', mbox: 'spam' })
    handler(fakeKey({ key: 'l' }))
    expect(dispatched.filter((d) => d.detail === 'override')).toHaveLength(0)
  })

  it('offenes Menü besitzt die Ziffern — 1 schaltet keinen Kontofilter um', () => {
    useUiStore.setState({ overrideMenuOpen: true })
    handler(fakeKey({ key: '1' }))
    expect(usePaper.getState().filter).toBeNull()
  })

  it('offenes Menü blockiert j/k-Navigation der Liste', () => {
    useUiStore.setState({ overrideMenuOpen: true })
    handler(fakeKey({ key: 'j' }))
    expect(dispatched.filter((d) => d.type === 'paper:move')).toHaveLength(0)
  })

  it('Esc schließt das offene Menü über die Kaskade', () => {
    useUiStore.setState({ overrideMenuOpen: true })
    handler(fakeKey({ key: 'Escape' }))
    expect(useUiStore.getState().overrideMenuOpen).toBe(false)
  })
})
