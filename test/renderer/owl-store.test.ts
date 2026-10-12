import { describe, it, expect, beforeEach } from 'vitest'
import type { PushPayload } from '@shared/ipc-contract'
import { enrichSources, historyForAsk, owlPhase, useOwl } from '@renderer/stores/owl'
import type { SemanticSearchHit } from '@renderer/features/search/useSemanticSearch'

// The Owl view state machine: empty → typing → asking → conversation → follow-up.
// The IPC calls live outside — only the pure transitions are tested here.

function chunk(over: Partial<PushPayload<'ai:chatChunk'>>): PushPayload<'ai:chatChunk'> {
  return { chatId: 'c1', chunk: '', done: false, error: null, sources: null, ...over }
}

function makeHit(over: Partial<SemanticSearchHit>): SemanticSearchHit {
  return {
    messageId: 1,
    threadKey: 'k1',
    accountId: 1,
    accountName: 'fernweh',
    mailbox: 'inbox',
    subject: 'Your Hetzner invoice for June',
    fromName: 'Hetzner Online',
    fromAddr: 'billing@hetzner.com',
    date: 1_752_576_600_000,
    excerpt: 'Invoice 2026-0642 …',
    signals: ['semantic'],
    confidence: 'clear',
    ...over
  }
}

describe('owl-store', () => {
  beforeEach(() => {
    useOwl.getState().newQuestion()
    useOwl.setState({ pendingFocus: false })
  })

  it('durchläuft empty → typing → asking → conversation', () => {
    expect(owlPhase(useOwl.getState())).toBe('empty')

    useOwl.getState().setQuery('hetzner rechnung')
    expect(owlPhase(useOwl.getState())).toBe('typing')

    const begun = useOwl.getState().beginAsk('hetzner rechnung')
    expect(begun).toEqual({ history: [] })
    expect(owlPhase(useOwl.getState())).toBe('asking')
    // Question line cleared the field; user turn + streaming answer are present
    expect(useOwl.getState().query).toBe('')
    expect(useOwl.getState().messages.map((m) => m.role)).toEqual(['user', 'assistant'])

    useOwl.getState().setChatId('c1')
    useOwl.getState().applyChunk(chunk({ chunk: 'Drei Rechnungen. ' }))
    useOwl.getState().applyChunk(chunk({ chunk: 'Hetzner zuerst.', done: true }))
    expect(owlPhase(useOwl.getState())).toBe('conversation')
    expect(useOwl.getState().messages[1]).toMatchObject({
      role: 'assistant',
      content: 'Drei Rechnungen. Hetzner zuerst.',
      pending: false
    })
  })

  it('ignoriert Chunks fremder chatIds', () => {
    useOwl.getState().beginAsk('frage')
    useOwl.getState().setChatId('c1')
    useOwl.getState().applyChunk(chunk({ chatId: 'fremd', chunk: 'NICHT MEINS' }))
    expect(useOwl.getState().messages[1].content).toBe('')
  })

  it('baut die Follow-up-History aus dem abgeschlossenen Verlauf', () => {
    useOwl.getState().beginAsk('Welche Rechnungen?')
    useOwl.getState().setChatId('c1')
    useOwl.getState().applyChunk(chunk({ chunk: 'Drei.', done: true }))

    const begun = useOwl.getState().beginAsk('Welche davon absetzbar?')
    expect(begun?.history).toEqual([
      { role: 'user', content: 'Welche Rechnungen?' },
      { role: 'assistant', content: 'Drei.' }
    ])
    // The streaming answer never counts toward history — completed turns do
    expect(historyForAsk(useOwl.getState().messages).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user'
    ])
  })

  it('räumt abgebrochene Fragen restlos auf (nichts zu speichern)', () => {
    useOwl.getState().beginAsk('kaputte frage')
    useOwl.getState().setChatId('c1')
    useOwl.getState().applyChunk(chunk({ error: 'Budget erschöpft', done: true }))

    const state = useOwl.getState()
    expect(state.messages).toEqual([])
    expect(state.asking).toBe(false)
    // Question moves back into the field, error is shown inline
    expect(state.query).toBe('kaputte frage')
    expect(state.askError).toBe('Budget erschöpft')
  })

  it('verweigert Doppel-Fragen und leere Fragen', () => {
    expect(useOwl.getState().beginAsk('   ')).toBeNull()
    useOwl.getState().beginAsk('erste')
    expect(useOwl.getState().beginAsk('zweite')).toBeNull()
  })

  it('lädt persistierte Gespräche und startet Folgefragen mit deren History', () => {
    useOwl.getState().openConversation({
      id: 42,
      messages: [
        { role: 'user', content: 'Frage?', at: 1 },
        { role: 'assistant', content: 'Antwort.', at: 2 }
      ]
    })
    expect(useOwl.getState().selConversationId).toBe(42)
    expect(owlPhase(useOwl.getState())).toBe('conversation')

    const begun = useOwl.getState().beginAsk('Nachgefragt?')
    expect(begun?.history).toEqual([
      { role: 'user', content: 'Frage?' },
      { role: 'assistant', content: 'Antwort.' }
    ])
  })

  it('n räumt zurück in den Leerzustand', () => {
    useOwl.getState().openConversation({
      id: 42,
      messages: [{ role: 'user', content: 'Frage?', at: 1 }]
    })
    useOwl.getState().setQuery('halb getippt')
    useOwl.getState().newQuestion()
    expect(useOwl.getState()).toMatchObject({
      selConversationId: null,
      messages: [],
      query: '',
      askError: null
    })
    expect(owlPhase(useOwl.getState())).toBe('empty')
  })

  it('reicht Quellen mit den Live-Treffern zum Frage-Zeitpunkt an', () => {
    const enriched = enrichSources(
      [
        { index: 1, threadKey: 'k1', subject: null },
        { index: 2, threadKey: 'unbekannt', subject: 'Ohne Kontext' }
      ],
      [makeHit({ threadKey: 'k1' })]
    )
    expect(enriched[0]).toMatchObject({
      subject: 'Your Hetzner invoice for June',
      accountName: 'fernweh',
      mailbox: 'inbox'
    })
    // Without a matching hit the source stays honestly minimal
    expect(enriched[1]).toEqual({ index: 2, threadKey: 'unbekannt', subject: 'Ohne Kontext' })
  })

  it('speichert Quellen samt Kontext am fertigen Beitrag', () => {
    useOwl.getState().beginAsk('hetzner?', [makeHit({ threadKey: 'k1' })])
    useOwl.getState().setChatId('c1')
    useOwl.getState().applyChunk(
      chunk({
        chunk: 'Gefunden.',
        done: true,
        sources: [{ index: 1, threadKey: 'k1', subject: null }]
      })
    )
    expect(useOwl.getState().messages[1].sources?.[0]).toMatchObject({
      threadKey: 'k1',
      accountName: 'fernweh',
      mailbox: 'inbox'
    })
  })
})
