import type Database from 'better-sqlite3-multiple-ciphers'
import { logUsage } from './budget'
import { getSetting } from '../db'
import { appleSpeechLocale, isAppleSpeechAvailable, transcribeWithApple } from './apple-speech'
import { getTaskProfileId, requireTaskWithBudget } from './providers/registry'

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
  // Apple-Spracherkennung (Pseudo-Profil 'apple'): on-device, ohne Kosten/Key, zählt als lokal
  if (getTaskProfileId('stt') === 'apple') {
    if (format !== 'wav') throw new Error('Apple-Diktat braucht WAV-Audio')
    const locale = appleSpeechLocale(getSetting('ui.language'))
    const state = await isAppleSpeechAvailable(locale)
    if (!state.available) throw new Error(`Apple-Diktat nicht verfügbar: ${state.reason}`)
    return transcribeWithApple(Buffer.from(audioBase64, 'base64'), 'wav', locale)
  }
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
