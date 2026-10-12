import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaper } from '@renderer/stores/paper'
import { calendarKeyAction } from '@renderer/features/calendar/keys'
import { useCalendar } from '@renderer/stores/calendar'
import { dayKey } from '@renderer/features/calendar/dates'

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

describe('Kalender-Tastenbelegung (rein)', () => {
  it('ordnet die Spezifikations-Tasten zu', () => {
    const expected: Record<string, string> = {
      d: 'day',
      w: 'week',
      m: 'month',
      t: 'today',
      j: 'next',
      ArrowRight: 'next',
      k: 'prev',
      ArrowLeft: 'prev',
      n: 'new',
      Enter: 'open',
      e: 'edit',
      Backspace: 'delete',
      Delete: 'delete'
    }
    for (const [key, action] of Object.entries(expected)) {
      expect(calendarKeyAction(key)).toBe(action)
    }
    expect(calendarKeyAction('x')).toBeNull()
    expect(calendarKeyAction('r')).toBeNull()
  })
})

describe('Keymap — Kalenderansicht', () => {
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
      view: 'calendar',
      paletteOpen: false,
      helpOpen: false,
      onboarding: false
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  const calendarEvents = (): unknown[] =>
    dispatched.filter((d) => d.type === 'paper:calendar').map((d) => d.detail)

  it('Tasten wirken als Kalender-Aktionen', () => {
    for (const key of ['d', 'w', 'm', 't', 'j', 'k', 'n', 'e', 'Enter', 'Backspace']) {
      handler(fakeKey({ key }))
    }
    expect(calendarEvents()).toEqual([
      'day',
      'week',
      'month',
      'today',
      'next',
      'prev',
      'new',
      'edit',
      'open',
      'delete'
    ])
  })

  it('j/k bewegen in der Kalenderansicht nicht die Listenauswahl', () => {
    handler(fakeKey({ key: 'j' }))
    expect(dispatched.filter((d) => d.type === 'paper:move')).toHaveLength(0)
  })

  it('keine Kalender-Aktion beim Tippen oder im Editor/Dialog', () => {
    handler(
      fakeKey({
        key: 'n',
        target: { tagName: 'INPUT', closest: () => null } as unknown as EventTarget
      })
    )
    handler(
      fakeKey({
        key: 'Enter',
        target: {
          tagName: 'BUTTON',
          closest: (s: string) => (s === '[data-cal-modal]' ? {} : null)
        } as unknown as EventTarget
      })
    )
    expect(calendarEvents()).toEqual([])
  })

  it('Wiederholung löst Neu/Öffnen/Löschen nicht mehrfach aus, Blättern aber schon', () => {
    handler(fakeKey({ key: 'n', repeat: true }))
    handler(fakeKey({ key: 'Enter', repeat: true }))
    handler(fakeKey({ key: 'Backspace', repeat: true }))
    handler(fakeKey({ key: 'j', repeat: true }))
    expect(calendarEvents()).toEqual(['next'])
  })

  it('Esc geht an die Kalenderansicht', () => {
    handler(fakeKey({ key: 'Escape' }))
    expect(calendarEvents()).toEqual(['escape'])
  })

  it('in anderen Ansichten bleiben die Tasten unberührt (keine Kalender-Events)', () => {
    usePaper.setState({ view: 'tasks' })
    handler(fakeKey({ key: 'd' }))
    handler(fakeKey({ key: 'w' }))
    handler(fakeKey({ key: 'n' }))
    expect(calendarEvents()).toEqual([])
    // d gehört in der Wartet-Ansicht weiter dem Verwerfen
    usePaper.setState({ view: 'waiting' })
    handler(fakeKey({ key: 'd' }))
    expect(dispatched).toContainEqual({ type: 'paper:waiting', detail: 'drop' })
  })

  it('⌘4 öffnet den Kalender, ⌘1–3 bleiben', () => {
    usePaper.setState({ view: 'inbox' })
    handler(fakeKey({ key: '4', metaKey: true }))
    expect(usePaper.getState().view).toBe('calendar')
    handler(fakeKey({ key: '3', metaKey: true }))
    expect(usePaper.getState().view).toBe('tasks')
    handler(fakeKey({ key: '1', ctrlKey: true }))
    expect(usePaper.getState().view).toBe('inbox')
  })
})

describe('Kalender-Store', () => {
  beforeEach(() => {
    useCalendar.setState({
      mode: 'week',
      anchor: '2026-10-05',
      selKey: null,
      editor: null,
      quick: null,
      deleteTarget: null
    })
  })

  it('Blättern je Ansicht', () => {
    const s = useCalendar.getState()
    s.shift(1)
    expect(useCalendar.getState().anchor).toBe('2026-10-12')
    s.setMode('month')
    useCalendar.getState().shift(1)
    expect(useCalendar.getState().anchor).toBe('2026-11-12')
    useCalendar.getState().setMode('day')
    useCalendar.getState().shift(-1)
    expect(useCalendar.getState().anchor).toBe('2026-11-11')
  })

  it('heute und Tagesansicht', () => {
    useCalendar.getState().goToday()
    expect(useCalendar.getState().anchor).toBe(dayKey(new Date()))
    useCalendar.getState().showDay('2026-12-24')
    expect(useCalendar.getState()).toMatchObject({ mode: 'day', anchor: '2026-12-24' })
  })

  it('focusEvent öffnet Ansicht, Tag, Auswahl und Editor', () => {
    usePaper.setState({ view: 'inbox' })
    useCalendar
      .getState()
      .focusEvent(7, '2026-10-19T08:00:00Z', new Date(2026, 9, 19, 10).getTime())
    expect(usePaper.getState().view).toBe('calendar')
    expect(useCalendar.getState()).toMatchObject({
      anchor: '2026-10-19',
      selKey: '7:2026-10-19T08:00:00Z',
      editor: { kind: 'existing', objectId: 7, recurrenceId: '2026-10-19T08:00:00Z' }
    })
  })
})
