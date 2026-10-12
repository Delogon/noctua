import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb } from '../helpers/db'

// Nur der Draft-Start wird gemockt — geprüft wird, dass der Handler den
// validierten Input vollständig durchreicht (M79: reviseText ging verloren).
vi.mock('@main/ai/drafts', () => ({
  startDraftReply: vi.fn(() => ({ draftId: 'draft-test' })),
  startDraftNew: vi.fn(),
  startDraftNudge: vi.fn(),
  stylePreview: vi.fn()
}))
// Zieht sonst die Hunspell-Wörterbücher als ?asset-Importe in den Test
vi.mock('@main/spell', () => ({ getSpellEngine: vi.fn() }))

import { startDraftReply } from '@main/ai/drafts'
import { handlers } from '@main/ipc/handlers'

describe('ai:draftReply — Handler reicht den Input vollständig durch', () => {
  let db: Database.Database
  afterEach(() => closeTestDb(db))

  it('gibt reviseText an startDraftReply weiter (Überarbeiten-Flow)', async () => {
    db = createTestDb()
    const input = {
      threadKey: 'k1',
      idea: 'Bitte Montag ergänzen.',
      reviseText: 'Hallo,\n\nich melde mich mit den Details.\n\nViele Grüße\nTim'
    }
    const result = await handlers['ai:draftReply'](input)
    expect(result).toEqual({ draftId: 'draft-test' })
    expect(vi.mocked(startDraftReply)).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function),
      {
        threadKey: 'k1',
        instruction: undefined,
        idea: 'Bitte Montag ergänzen.',
        reviseText: input.reviseText
      }
    )
  })
})
