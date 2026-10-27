import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useSendState, echoConfirmedBy, type SentEcho } from '@renderer/stores/send'
import type { ThreadListItem } from '@shared/types'
import { usePaper } from '@renderer/stores/paper'
import { useToast } from '@renderer/stores/toast'

const NOW = new Date('2026-07-15T12:00:00').getTime()

function mkItem(over: Partial<ThreadListItem> = {}): ThreadListItem {
  return {
    threadKey: 'tk-1',
    accountId: 1,
    accountColor: '#c3b8e0',
    subject: 'Bauzäune für Kommunalwahl',
    snippet: null,
    fromNames: ['Lena Hartmann'],
    toNames: ['heike.boldt@posteo.de'],
    date: NOW + 5_000,
    messageCount: 1,
    unread: false,
    flagged: false,
    hasAttachments: false,
    aiCategory: null,
    aiPriority: null,
    aiSummary: null,
    needsReply: false,
    suggestedTask: null,
    taskState: 'none',
    ...over
  }
}

function mkEcho(over: Partial<SentEcho> = {}): SentEcho {
  return {
    outboxId: 7,
    accountId: 1,
    subject: 'Bauzäune für Kommunalwahl',
    toNames: ['heike.boldt@posteo.de'],
    date: NOW,
    state: 'sent',
    ...over
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  useSendState.setState({ pending: null, echoes: [] })
  useToast.setState({ current: null, queue: [] })
})

afterEach(() => vi.useRealTimers())

describe('useSendState — Gesendet-Echos', () => {
  it('begin legt ein Echo im Zustand pending an', () => {
    useSendState.getState().begin({
      outboxId: 7,
      sendAt: NOW + 30_000,
      accountId: 1,
      fromAddr: 'tim@fernweh.studio',
      subject: 'Test',
      to: ['a@b.de']
    })
    const { echoes } = useSendState.getState()
    expect(echoes).toHaveLength(1)
    expect(echoes[0]).toMatchObject({
      outboxId: 7,
      state: 'pending',
      subject: 'Test',
      toNames: ['a@b.de'],
      date: NOW
    })
  })

  it('begin zeigt den Undo-Send-Countdown als Toast bis sendAt', () => {
    useSendState.getState().begin({
      outboxId: 7,
      sendAt: NOW + 30_000,
      accountId: 1,
      fromAddr: 'tim@fernweh.studio',
      subject: 'Test',
      to: ['a@b.de']
    })
    const current = useToast.getState().current
    expect(current?.kind).toBe('countdown')
    expect(current?.countdown?.until).toBe(NOW + 30_000)
    expect(current?.countdown?.textFor(4)).toContain('tim@fernweh.studio')
    expect(current?.action?.kbd).toBe('⌘Z')
  })

  it('setEchoState wechselt den Zustand und räumt sent-Echos nach 90s auf', () => {
    useSendState.setState({ echoes: [mkEcho({ state: 'pending' })] })
    useSendState.getState().setEchoState(7, 'sent')
    expect(useSendState.getState().echoes[0].state).toBe('sent')
    vi.advanceTimersByTime(90_000)
    expect(useSendState.getState().echoes).toHaveLength(0)
  })

  it('error-Echos verschwinden nach 10s', () => {
    useSendState.setState({ echoes: [mkEcho({ state: 'sending' })] })
    useSendState.getState().setEchoState(7, 'error')
    vi.advanceTimersByTime(9_000)
    expect(useSendState.getState().echoes).toHaveLength(1)
    vi.advanceTimersByTime(1_000)
    expect(useSendState.getState().echoes).toHaveLength(0)
  })

  it('setEchoState für unbekannte outboxId ist ein No-op', () => {
    useSendState.getState().setEchoState(99, 'sent')
    expect(useSendState.getState().echoes).toHaveLength(0)
  })

  it('dropEcho entfernt sofort und storniert den Fallback-Timer', () => {
    useSendState.setState({ echoes: [mkEcho({ state: 'pending' })] })
    useSendState.getState().setEchoState(7, 'sent')
    useSendState.getState().dropEcho(7)
    expect(useSendState.getState().echoes).toHaveLength(0)
    expect(() => vi.advanceTimersByTime(120_000)).not.toThrow()
  })
})

describe('echoConfirmedBy — Server-Kopie erkennen', () => {
  it('matcht gleiches Konto, jüngeres Datum und gleichen Betreff', () => {
    expect(echoConfirmedBy(mkEcho(), mkItem())).toBe(true)
  })

  it('ignoriert Re:/AW:-Präfixe und Groß-/Kleinschreibung', () => {
    const echo = mkEcho({ subject: 'Re: Bauzäune für Kommunalwahl' })
    expect(echoConfirmedBy(echo, mkItem({ subject: 'bauzäune für kommunalwahl' }))).toBe(true)
  })

  it('matcht nur Echos im Zustand sent', () => {
    expect(echoConfirmedBy(mkEcho({ state: 'sending' }), mkItem())).toBe(false)
  })

  it('matcht nicht bei fremdem Konto oder altem Thread-Datum', () => {
    expect(echoConfirmedBy(mkEcho(), mkItem({ accountId: 2 }))).toBe(false)
    expect(echoConfirmedBy(mkEcho(), mkItem({ date: NOW - 120_000 }))).toBe(false)
  })
})

describe('Aufgeschobene Archivierung (Antworten)', () => {
  const invokeMock = vi.fn()

  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ ok: true })
    vi.stubGlobal('window', { noctua: { invoke: invokeMock, on: vi.fn() } })
    usePaper.setState({ hiddenThreads: new Set(), selThreadKey: null, view: 'compose' })
    usePaper.getState().resetComp()
  })

  afterEach(() => vi.unstubAllGlobals())

  it('begin versteckt den Thread, statt sofort zu archivieren', () => {
    useSendState.getState().begin({
      outboxId: 21,
      sendAt: NOW + 20_000,
      accountId: 1,
      fromAddr: 'tim@fernweh.studio',
      subject: 'Re: Bauzäune',
      to: ['a@b.de'],
      archive: { threadKey: 'tk-1', messageIds: [11, 12] }
    })
    expect(usePaper.getState().hiddenThreads.has('tk-1')).toBe(true)
    expect(invokeMock).not.toHaveBeenCalledWith('messages:action', expect.anything())
  })

  it('cancel zeigt den Thread wieder, wählt ihn aus und legt den Entwurf in den Antwort-Composer', async () => {
    invokeMock.mockImplementation(async (channel: string) =>
      channel === 'outbox:cancel'
        ? {
            ok: true,
            accountId: 1,
            draft: {
              to: ['a@b.de'],
              cc: [],
              bcc: [],
              subject: 'Re: Bauzäune',
              textBody: 'Hallo Heike,\npasst.',
              htmlBody: '<div>Hallo Heike,</div><div>passt.</div>'
            }
          }
        : { ok: true }
    )
    useSendState.getState().begin({
      outboxId: 22,
      sendAt: NOW + 20_000,
      accountId: 1,
      fromAddr: 'tim@fernweh.studio',
      subject: 'Re: Bauzäune',
      to: ['a@b.de'],
      archive: { threadKey: 'tk-2', messageIds: [13] }
    })

    await useSendState.getState().cancel(22)

    const paper = usePaper.getState()
    expect(paper.hiddenThreads.has('tk-2')).toBe(false)
    expect(paper.selThreadKey).toBe('tk-2')
    expect(paper.view).toBe('inbox')
    expect(paper.comp.threadKey).toBe('tk-2')
    expect(paper.comp.text).toBe('Hallo Heike,\npasst.')
    expect(paper.comp.mode).toBe('ready')
    // It was never archived
    expect(invokeMock).not.toHaveBeenCalledWith(
      'messages:action',
      expect.objectContaining({ action: 'archive' })
    )
    // Countdown toast disappears silently — the composer returning is the feedback
    expect(useToast.getState().current).toBeNull()
    expect(useToast.getState().queue).toHaveLength(0)
  })
})
