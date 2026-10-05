import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { getSecret, hasSecret } from '@main/auth/secrets'
import { getSetting, setSetting } from '@main/db'
import { setLocalOnly } from '@main/privacy'
import {
  budgetBlocks,
  clearProfileKey,
  createProfile,
  deleteProfile,
  getClient,
  getProfile,
  getTaskProfileId,
  listProfiles,
  normalizeBaseUrl,
  profileSecretKey,
  requireTask,
  resolveTask,
  setProfileKey,
  setTaskAssignment,
  taskBlockReason,
  triageBudgetBlocked,
  updateProfile
} from '@main/ai/providers/registry'
import { logUsage } from '@main/ai/budget'
import { closeTestDb, createTestDb } from '../helpers/db'

// Der SDK-Client wird nie gebraucht, aber das Modul zieht „openai" — sauber wegmocken
vi.mock('@main/ai/providers/openai-factory', () => ({
  createOpenAiClient: () => ({ chat: { completions: { create: vi.fn() } } })
}))

let db: Database.Database
beforeEach(() => {
  db = createTestDb()
})
afterEach(() => closeTestDb(db))

const local = {
  name: 'Ollama',
  baseUrl: 'http://localhost:11434/v1/',
  apiStyle: 'chat' as const,
  isLocal: true
}

describe('Migration 026: OpenRouter-Profil', () => {
  it('seedet das eingebaute OpenRouter-Profil mit Upstream-Verhalten', () => {
    expect(listProfiles()).toEqual([
      {
        id: 'openrouter',
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiStyle: 'chat',
        isLocal: false,
        preset: 'openrouter',
        hasKey: false
      }
    ])
  })

  it('ordnet alle Aufgaben dem OpenRouter-Profil zu', () => {
    expect(getTaskProfileId('triage')).toBe('openrouter')
    expect(getTaskProfileId('draft')).toBe('openrouter')
    expect(getTaskProfileId('stt')).toBe('openrouter')
  })

  it('hasKey folgt dem bestehenden Vault-Eintrag openrouter.apiKey', () => {
    setProfileKey('openrouter', 'sk-or-1')
    expect(getSecret('openrouter.apiKey')).toBe('sk-or-1')
    expect(getProfile('openrouter')!.hasKey).toBe(true)
  })
})

describe('Profil-CRUD', () => {
  it('legt Profile an: URL normalisiert, Name getrimmt, Key im Vault unter ai.profile.<id>', () => {
    const p = createProfile({ ...local, name: '  Ollama  ' })
    expect(p.id).toMatch(/^p_[0-9a-f]{10}$/)
    expect(p).toMatchObject({
      name: 'Ollama',
      baseUrl: 'http://localhost:11434/v1',
      preset: 'custom',
      isLocal: true,
      hasKey: false
    })
    setProfileKey(p.id, 'geheim')
    expect(hasSecret(`ai.profile.${p.id}.apiKey`)).toBe(true)
    expect(getProfile(p.id)!.hasKey).toBe(true)
    // Key des OpenRouter-Profils bleibt unberührt
    expect(hasSecret('openrouter.apiKey')).toBe(false)
    clearProfileKey(p.id)
    expect(getProfile(p.id)!.hasKey).toBe(false)
  })

  it('lehnt unbrauchbare URLs und leere Namen ab', () => {
    expect(() => createProfile({ ...local, baseUrl: 'kaputt' })).toThrow(/URL/)
    expect(() => createProfile({ ...local, baseUrl: 'ftp://x.de' })).toThrow(/http/)
    expect(() => createProfile({ ...local, name: '   ' })).toThrow(/Name/)
    expect(normalizeBaseUrl(' https://api.example.com/v1/// ')).toBe('https://api.example.com/v1')
  })

  it('ändert eigene Profile; beim OpenRouter-Preset bleiben URL/Stil/Flag fix', () => {
    const p = createProfile(local)
    const changed = updateProfile(p.id, { name: 'Lokal', apiStyle: 'responses', isLocal: false })
    expect(changed).toMatchObject({ name: 'Lokal', apiStyle: 'responses', isLocal: false })

    const or = updateProfile('openrouter', {
      name: 'OR',
      baseUrl: 'http://evil.example/v1',
      apiStyle: 'responses',
      isLocal: true
    })
    expect(or).toMatchObject({
      name: 'OR',
      baseUrl: 'https://openrouter.ai/api/v1',
      apiStyle: 'chat',
      isLocal: false
    })
  })

  it('löscht Profil samt Key; Aufgaben fallen auf OpenRouter zurück', () => {
    const p = createProfile(local)
    setProfileKey(p.id, 'k')
    setTaskAssignment('draft', p.id, 'llama3.2')
    deleteProfile(p.id)
    expect(getProfile(p.id)).toBeNull()
    expect(hasSecret(profileSecretKey({ id: p.id, preset: 'custom' }))).toBe(false)
    expect(getTaskProfileId('draft')).toBe('openrouter')
    expect(getSetting('ai.draftModel')).toBeNull()
  })

  it('schützt das OpenRouter-Profil vor dem Löschen', () => {
    expect(() => deleteProfile('openrouter')).toThrow(/nicht gelöscht/)
  })

  it('cacht Clients pro Profil+Key und baut bei Änderungen neu', () => {
    const p = createProfile(local)
    const a = getClient(getProfile(p.id)!)
    expect(getClient(getProfile(p.id)!)).toBe(a)
    setProfileKey(p.id, 'neu')
    const b = getClient(getProfile(p.id)!)
    expect(b).not.toBe(a)
    updateProfile(p.id, { baseUrl: 'http://localhost:1234/v1' })
    expect(getClient(getProfile(p.id)!)).not.toBe(b)
  })
})

describe('resolveTask', () => {
  it('OpenRouter ohne Key: null (no-key) wie bisher; mit Key: Defaults', () => {
    expect(resolveTask('triage')).toBeNull()
    expect(taskBlockReason('triage')).toBe('no-key')
    expect(() => requireTask('draft')).toThrow(/Kein OpenRouter-Key/)

    setProfileKey('openrouter', 'k')
    expect(resolveTask('triage')!.model).toBe('deepseek/deepseek-v4-flash')
    expect(resolveTask('draft')!.model).toBe('anthropic/claude-opus-4.8')
    expect(resolveTask('stt')!.model).toBe('openai/gpt-audio-mini')
    expect(resolveTask('draft')!.profile.id).toBe('openrouter')
  })

  it('bestehende Modell-Settings (ai.draftModel) gelten für das OpenRouter-Profil', () => {
    setProfileKey('openrouter', 'k')
    setSetting('ai.draftModel', 'openai/gpt-5')
    expect(resolveTask('draft')!.model).toBe('openai/gpt-5')
  })

  it('eigenes Profil: ohne Key nutzbar, braucht aber ein ausdrücklich gewähltes Modell', () => {
    const p = createProfile(local)
    setSetting('ai.draftProfile', p.id)
    expect(taskBlockReason('draft')).toBe('no-model')
    setTaskAssignment('draft', p.id, 'llama3.2:latest')
    const resolved = resolveTask('draft')!
    expect(resolved.model).toBe('llama3.2:latest')
    expect(resolved.profile.id).toBe(p.id)
  })

  it('Local only: externe Profile werden verweigert, lokale laufen', () => {
    setProfileKey('openrouter', 'k')
    const ollama = createProfile(local)
    const cloud = createProfile({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiStyle: 'responses',
      isLocal: false
    })
    setTaskAssignment('triage', ollama.id, 'qwen3:8b')
    setTaskAssignment('draft', cloud.id, 'gpt-5')

    setLocalOnly(true)
    expect(resolveTask('triage')!.profile.id).toBe(ollama.id)
    expect(resolveTask('draft')).toBeNull()
    expect(resolveTask('stt')).toBeNull() // OpenRouter, extern
    expect(taskBlockReason('draft')).toBe('local-only')
    expect(() => requireTask('draft')).toThrow(/Local only/)

    setLocalOnly(false)
    expect(resolveTask('draft')!.profile.id).toBe(cloud.id)
  })

  it('Apple On-Device ist als Triage-Zuordnung gültig und zählt als lokal', () => {
    setTaskAssignment('triage', 'apple', '')
    expect(getTaskProfileId('triage')).toBe('apple')
    expect(getSetting('ai.triageProvider')).toBe('apple')
    expect(() => setTaskAssignment('draft', 'apple', '')).toThrow()
    // zurück auf ein echtes Profil
    setTaskAssignment('triage', 'openrouter', 'x/y')
    expect(getTaskProfileId('triage')).toBe('openrouter')
    expect(getSetting('ai.triageProvider')).toBe('openrouter')
  })

  it('Apple-Spracherkennung ist als stt-Pseudo-Profil wählbar', () => {
    setTaskAssignment('stt', 'apple', '')
    expect(getTaskProfileId('stt')).toBe('apple')
    expect(resolveTask('stt')).toBeNull() // kein Client — transcribe.ts behandelt 'apple' selbst
    setTaskAssignment('stt', 'openrouter', '')
    expect(getTaskProfileId('stt')).toBe('openrouter')
  })

  it('lehnt Zuordnung auf unbekanntes Profil ab', () => {
    expect(() => setTaskAssignment('draft', 'gibtsnicht', 'm')).toThrow(/nicht gefunden/)
  })
})

describe('Budget-Gate', () => {
  function exhaust(): void {
    logUsage(db, 'm', 1, 1, 100)
  }

  it('gilt nur für externe, bepreiste Profile', () => {
    setProfileKey('openrouter', 'k')
    const ollama = createProfile(local)
    setTaskAssignment('triage', ollama.id, 'qwen3:8b')
    exhaust()

    expect(budgetBlocks(db, resolveTask('draft')!)).toBe(true)
    expect(budgetBlocks(db, resolveTask('triage')!)).toBe(false)
    expect(triageBudgetBlocked(db)).toBe(false)

    setTaskAssignment('triage', 'openrouter', 'x/y')
    expect(triageBudgetBlocked(db)).toBe(true)
    setTaskAssignment('triage', 'apple', '')
    expect(triageBudgetBlocked(db)).toBe(false)
  })

  it('externes Custom-Profil ist unbepreist — kein Gate', () => {
    const cloud = createProfile({
      name: 'X',
      baseUrl: 'https://api.example.com/v1',
      apiStyle: 'chat',
      isLocal: false
    })
    setTaskAssignment('draft', cloud.id, 'm')
    exhaust()
    expect(budgetBlocks(db, resolveTask('draft')!)).toBe(false)
  })
})
