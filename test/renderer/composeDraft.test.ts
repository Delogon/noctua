import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isComposeDraftEmpty,
  loadComposeDraft,
  saveComposeDraft,
  type ComposeDraft
} from '@renderer/lib/composeDraft'

// Simulierter settings-Store hinter der Preload-Brücke
const settings = new Map<string, string>()
vi.stubGlobal('window', {
  noctua: {
    invoke: vi.fn((channel: string, input: { key: string; value?: string }) => {
      if (channel === 'settings:get') {
        return Promise.resolve({ value: settings.get(input.key) ?? null })
      }
      if (channel === 'settings:set') {
        settings.set(input.key, input.value ?? '')
        return Promise.resolve({ ok: true })
      }
      return Promise.reject(new Error(`unerwarteter Kanal: ${channel}`))
    })
  }
})

function mkDraft(over: Partial<ComposeDraft> = {}): ComposeDraft {
  return {
    accountId: 1,
    to: ['heike.boldt@posteo.de'],
    cc: [],
    bcc: [],
    subject: 'Kennenlernen',
    body: 'Moin!\n\nTim',
    html: '<div>Moin!</div>',
    ...over
  }
}

beforeEach(() => settings.clear())

describe('isComposeDraftEmpty', () => {
  it('leer ohne Empfänger, Betreff und Body', () => {
    expect(isComposeDraftEmpty(mkDraft({ to: [], subject: '', body: '  \n', html: '' }))).toBe(true)
  })

  it('nicht leer bei Empfänger, BCC, Betreff oder eigenem Text', () => {
    expect(isComposeDraftEmpty(mkDraft({ subject: '', body: '' }))).toBe(false)
    expect(isComposeDraftEmpty(mkDraft({ to: [], body: '' }))).toBe(false)
    expect(isComposeDraftEmpty(mkDraft({ to: [], subject: '' }))).toBe(false)
    expect(isComposeDraftEmpty(mkDraft({ to: [], subject: '', body: '', bcc: ['x@y.de'] }))).toBe(
      false
    )
  })
})

describe('saveComposeDraft / loadComposeDraft', () => {
  it('Roundtrip erhält alle Felder', async () => {
    const draft = mkDraft({
      cc: ['jens@example.org'],
      bcc: ['leise@example.org'],
      replyToMessageId: 42
    })
    await saveComposeDraft(draft)
    expect(await loadComposeDraft()).toEqual(draft)
  })

  it('null löscht den Entwurf', async () => {
    await saveComposeDraft(mkDraft())
    await saveComposeDraft(null)
    expect(await loadComposeDraft()).toBeNull()
  })

  it('liefert null ohne gespeicherten Entwurf oder bei kaputtem JSON', async () => {
    expect(await loadComposeDraft()).toBeNull()
    settings.set('compose.draft', '{kaputt')
    expect(await loadComposeDraft()).toBeNull()
    settings.set('compose.draft', '{"to":"kein-array","cc":[]}')
    expect(await loadComposeDraft()).toBeNull()
  })

  it('saniert fremde Feldtypen (auch Alt-Entwürfe ohne bcc/html)', async () => {
    settings.set(
      'compose.draft',
      JSON.stringify({ accountId: 'x', to: ['a@b.de', 7], cc: [], subject: 3, body: null })
    )
    expect(await loadComposeDraft()).toEqual({
      accountId: null,
      to: ['a@b.de'],
      cc: [],
      bcc: [],
      subject: '',
      body: '',
      html: '',
      replyToMessageId: undefined
    })
  })

  it('kappt überlange Inhalte unter dem settings-Limit', async () => {
    await saveComposeDraft(mkDraft({ body: 'x'.repeat(99_000), html: 'y'.repeat(99_000) }))
    const loaded = await loadComposeDraft()
    expect(loaded?.body.length).toBe(40_000)
    expect(loaded?.html.length).toBe(40_000)
  })
})
