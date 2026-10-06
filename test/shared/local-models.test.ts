import { describe, expect, it } from 'vitest'
import { modelSizeB, pickLocalModels } from '@shared/local-models'

describe('modelSizeB', () => {
  it('liest die Parametergröße aus gängigen Modellnamen', () => {
    expect(modelSizeB('llama3.2:3b')).toBe(3)
    expect(modelSizeB('qwen3:30b-a3b')).toBe(30)
    expect(modelSizeB('gemma-3-12b-it')).toBe(12)
    expect(modelSizeB('qwen2.5-coder-7b-instruct')).toBe(7)
    expect(modelSizeB('smollm2:360m')).toBeCloseTo(0.36)
    expect(modelSizeB('gpt-oss:120b')).toBe(120)
  })

  it('null ohne Größenangabe', () => {
    expect(modelSizeB('phi4-mini')).toBeNull()
    expect(modelSizeB('llama3.2:latest')).toBeNull()
    expect(modelSizeB('gemma3n:e4b')).toBeNull()
  })
})

describe('pickLocalModels', () => {
  it('klein+schnell für die Sortierung, das größte für Entwürfe', () => {
    expect(pickLocalModels(['qwen3:30b', 'llama3.2:3b', 'llama3.1:8b'])).toEqual({
      triage: 'llama3.2:3b',
      draft: 'qwen3:30b'
    })
  })

  it('Spielzeugmodelle unter 3 B nur, wenn nichts Größeres da ist', () => {
    expect(pickLocalModels(['smollm2:360m', 'llama3.1:8b']).triage).toBe('llama3.1:8b')
    expect(pickLocalModels(['smollm2:360m', 'qwen2.5:0.5b'])).toEqual({
      triage: 'smollm2:360m',
      draft: 'qwen2.5:0.5b'
    })
  })

  it('überspringt Embedding- und Sprachmodelle', () => {
    expect(
      pickLocalModels(['nomic-embed-text:latest', 'whisper-large-v3', 'mistral:7b']).draft
    ).toBe('mistral:7b')
  })

  it('ohne Größenangaben das erste Chat-Modell für beides; leer bleibt leer', () => {
    expect(pickLocalModels(['phi4-mini', 'foo'])).toEqual({
      triage: 'phi4-mini',
      draft: 'phi4-mini'
    })
    expect(pickLocalModels([])).toEqual({ triage: '', draft: '' })
  })

  it('nur Embedding-Modelle: trotzdem ein Vorschlag statt leer', () => {
    expect(pickLocalModels(['nomic-embed-text']).triage).toBe('nomic-embed-text')
  })
})
