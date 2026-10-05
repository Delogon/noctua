import type Database from 'better-sqlite3'
import { logUsage } from './budget'
import { requireTaskWithBudget } from './providers/registry'

/**
 * Diktat-Transkription über das Profil der Aufgabe „stt": bei OpenRouter ein
 * Audio-Input-Chat-Modell (input_audio), bei eigenen Profilen ein
 * Whisper-kompatibler /audio/transcriptions-Endpunkt. Gibt NUR das Transkript zurück.
 */
export async function transcribeAudio(
  db: Database.Database,
  audioBase64: string,
  format: 'wav' | 'mp3'
): Promise<string> {
  const { client, model, profile } = requireTaskWithBudget(db, 'stt')
  if (!client.transcribe) {
    throw new Error(`Profil „${profile.name}" unterstützt keine Transkription`)
  }
  const result = await client.transcribe(audioBase64, format, model)
  const { inputTokens, outputTokens, costUsd } = result.usage
  logUsage(db, model, inputTokens, outputTokens, costUsd)
  const text = result.text.trim()
  // [LEER] = Modell hat nichts Verwertbares gehört → leeres Transkript,
  // der Aufrufer zeigt dann einen verständlichen Hinweis statt Modell-Prosa
  if (text === '[LEER]' || /^\[LEER\]$/i.test(text)) return ''
  return text
}
