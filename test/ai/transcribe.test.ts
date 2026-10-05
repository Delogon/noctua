import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import type Database from 'better-sqlite3'
import { createProfile, setTaskAssignment } from '@main/ai/providers/registry'
import { setSecret } from '@main/auth/secrets'
import { setLocalOnly } from '@main/privacy'
import { closeTestDb, createAiTestDb } from '../helpers/db'

// SDK-Client wird gemockt — geprüft werden [LEER]-Protokoll und Profil-Weg, nicht das Netz
const { createMock, transcriptionMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  transcriptionMock: vi.fn()
}))
vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({
    chat: { completions: { create: createMock } },
    audio: { transcriptions: { create: transcriptionMock } }
  })
}))

import { transcribeAudio } from '@main/ai/transcribe'

let db: Database.Database
beforeEach(() => {
  db = createAiTestDb()
})
afterEach(() => {
  closeTestDb(db)
  createMock.mockReset()
  transcriptionMock.mockReset()
})

describe('transcribeAudio — [LEER]-Protokoll (OpenRouter, Audio-Input-Chat)', () => {
  it('mappt [LEER] (nichts gehört) auf ein leeres Transkript', async () => {
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: '[LEER]' } }] })
    expect(await transcribeAudio(db, 'QUJD', 'wav')).toBe('')
  })

  it('gibt echte Transkripte unverändert zurück', async () => {
    createMock.mockResolvedValueOnce({
      choices: [{ message: { content: 'Welche Rechnungen kamen diese Woche?' } }]
    })
    expect(await transcribeAudio(db, 'QUJD', 'wav')).toBe('Welche Rechnungen kamen diese Woche?')
    // Audio geht als input_audio im Chat-Format raus
    const body = createMock.mock.calls[0][0] as {
      messages: Array<{ content: Array<{ type: string }> }>
    }
    expect(body.messages[0].content.map((p) => p.type)).toEqual(['text', 'input_audio'])
  })
})

describe('transcribeAudio — eigenes Profil (Whisper-kompatibel)', () => {
  it('nutzt audio.transcriptions statt Chat', async () => {
    const profile = createProfile({
      name: 'Whisper lokal',
      baseUrl: 'http://localhost:8080/v1',
      apiStyle: 'chat',
      isLocal: true
    })
    setTaskAssignment('stt', profile.id, 'whisper-1')
    transcriptionMock.mockResolvedValueOnce({ text: ' Hallo Welt ' })
    expect(await transcribeAudio(db, 'QUJD', 'wav')).toBe('Hallo Welt')
    expect(createMock).not.toHaveBeenCalled()
    expect(transcriptionMock.mock.calls[0][0].model).toBe('whisper-1')
  })

  it('Local only blockiert externe Profile mit klarer Meldung', async () => {
    setSecret('openrouter.apiKey', 'k')
    setLocalOnly(true)
    await expect(transcribeAudio(db, 'QUJD', 'wav')).rejects.toThrow(/Local only/)
    expect(createMock).not.toHaveBeenCalled()
  })
})
