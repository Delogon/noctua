import type Database from 'better-sqlite3-multiple-ciphers'
import { logUsage } from './budget'
import { getSetting } from '../db'
import { appleSpeechLocale, isAppleSpeechAvailable, transcribeWithApple } from './apple-speech'
import { getTaskProfileId, requireTaskWithBudget } from './providers/registry'

/**
 * Dictation transcription via the profile of the "stt" task: for OpenRouter an
 * audio-input chat model (input_audio), for custom profiles a
 * Whisper-compatible /audio/transcriptions endpoint. Returns ONLY the transcript.
 */
export async function transcribeAudio(
  db: Database.Database,
  audioBase64: string,
  format: 'wav' | 'mp3'
): Promise<string> {
  // Apple speech recognition (pseudo profile 'apple'): on-device, no cost/key, counts as local
  if (getTaskProfileId('stt') === 'apple') {
    if (format !== 'wav') throw new Error('Apple-Diktat braucht WAV-Audio')
    const locale = appleSpeechLocale(getSetting('ui.language'))
    const state = await isAppleSpeechAvailable(locale)
    if (!state.available) throw new Error(`Apple-Diktat nicht verfügbar: ${state.reason}`)
    return transcribeWithApple(Buffer.from(audioBase64, 'base64'), 'wav', locale)
  }
  const { client, model, profile } = requireTaskWithBudget(db, 'stt')
  if (!client.transcribe) {
    throw new Error(`Anbieter „${profile.name}“ unterstützt keine Transkription`)
  }
  const result = await client.transcribe(audioBase64, format, model)
  const { inputTokens, outputTokens, costUsd } = result.usage
  logUsage(db, model, inputTokens, outputTokens, costUsd)
  const text = result.text.trim()
  // [LEER] = the model heard nothing usable → empty transcript,
  // the caller then shows an understandable notice instead of model prose
  if (text === '[LEER]' || /^\[LEER\]$/i.test(text)) return ''
  return text
}
