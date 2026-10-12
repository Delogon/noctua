import { describe, it, expect, afterEach, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { createTestDb, closeTestDb } from '../helpers/db'

// Only the draft start is mocked — checks that the handler passes the
// validated input through completely (M79: reviseText was lost).
vi.mock('@main/ai/drafts', () => ({
  startDraftReply: vi.fn(() => ({ draftId: 'draft-test' })),
  startDraftNew: vi.fn(),
  startDraftNudge: vi.fn(),
  stylePreview: vi.fn()
}))
// Otherwise pulls the Hunspell dictionaries into the test as ?asset imports
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
