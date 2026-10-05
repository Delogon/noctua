import { describe, it, expect, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'

// OpenRouter mocken — geprüft wird das [LEER]-Protokoll, nicht das Netz
const createMock = vi.fn()
vi.mock('@main/ai/openrouter', () => ({
  getOpenRouter: () => ({ chat: { completions: { create: createMock } } }),
  getSttModel: () => 'openai/gpt-audio-mini',
  extractUsage: () => ({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
  providerBody: () => ({})
}))
vi.mock('@main/ai/budget', () => ({
  isBudgetExceeded: () => false,
  logUsage: vi.fn()
}))

import { transcribeAudio } from '@main/ai/transcribe'

const db = {} as Database.Database

describe('transcribeAudio — [LEER]-Protokoll', () => {
  it('mappt [LEER] (nichts gehört) auf ein leeres Transkript', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: '[LEER]' } }] })
    expect(await transcribeAudio(db, 'QUJD', 'wav')).toBe('')
  })

  it('gibt echte Transkripte unverändert zurück', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Welche Rechnungen kamen diese Woche?' } }]
    })
    expect(await transcribeAudio(db, 'QUJD', 'wav')).toBe('Welche Rechnungen kamen diese Woche?')
  })
})
