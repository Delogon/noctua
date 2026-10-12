import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaper } from '@renderer/stores/paper'
import { initDraftAutosave, removeDraft } from '@renderer/features/paper/draft-autosave'

/**
 * Der Autosave lauscht zentral auf den paper-Store: Tippen wird entprellt
 * gesichert, ein Threadwechsel sichert sofort, Senden/Löschen darf den
 * Entwurf nicht wiederbeleben.
 */

const invokeMock = vi.fn().mockResolvedValue({ ok: true })
vi.stubGlobal('window', { noctua: { invoke: invokeMock, on: vi.fn() } })

function saveCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([channel]) => channel === 'drafts:save')
}

function deleteCalls(): unknown[][] {
  return invokeMock.mock.calls.filter(([channel]) => channel === 'drafts:delete')
}

describe('draft-autosave', () => {
  let unsubscribe: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    invokeMock.mockClear()
    usePaper.getState().resetComp()
    invokeMock.mockClear()
    unsubscribe = initDraftAutosave(() => {})
  })

  afterEach(() => {
    unsubscribe()
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('sichert Tippen entprellt als Entwurf', () => {
    usePaper.getState().setComp({ threadKey: 't1', text: 'Hallo Alice', mode: 'ready' })
    expect(saveCalls()).toHaveLength(0)

    vi.advanceTimersByTime(700)
    expect(saveCalls()).toEqual([
      ['drafts:save', { threadKey: 't1', text: 'Hallo Alice', html: '' }]
    ])
  })

  it('bündelt schnelles Tippen zu einer Speicherung mit dem letzten Stand', () => {
    usePaper.getState().setComp({ threadKey: 't1', text: 'Ha', mode: 'ready' })
    vi.advanceTimersByTime(300)
    usePaper.getState().setComp({ text: 'Hallo' })
    vi.advanceTimersByTime(700)

    expect(saveCalls()).toEqual([['drafts:save', { threadKey: 't1', text: 'Hallo', html: '' }]])
  })

  it('sichert beim Threadwechsel sofort, ohne auf die Entprellung zu warten', () => {
    usePaper.getState().setComp({ threadKey: 't1', text: 'Hallo Alice', mode: 'ready' })
    usePaper.getState().resetComp()

    expect(saveCalls()).toEqual([
      ['drafts:save', { threadKey: 't1', text: 'Hallo Alice', html: '' }]
    ])
  })

  it('belebt den Entwurf nach Senden oder Löschen nicht wieder', () => {
    usePaper.getState().setComp({ threadKey: 't1', text: 'Hallo Alice', mode: 'ready' })
    usePaper.getState().setComp({ mode: 'sending' })
    usePaper.getState().resetComp()
    removeDraft('t1')
    vi.advanceTimersByTime(1000)

    expect(saveCalls()).toHaveLength(0)
    expect(deleteCalls()).toEqual([['drafts:delete', { threadKey: 't1' }]])
  })

  it('löscht den gespeicherten Entwurf, wenn der Text bewusst geleert wird', () => {
    usePaper.getState().setComp({ threadKey: 't1', text: 'Hallo Alice', mode: 'ready' })
    vi.advanceTimersByTime(700)
    usePaper.getState().setComp({ text: '', html: '' })

    expect(deleteCalls()).toEqual([['drafts:delete', { threadKey: 't1' }]])
    vi.advanceTimersByTime(1000)
    expect(saveCalls()).toHaveLength(1)
  })
})
