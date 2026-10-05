import type Database from 'better-sqlite3-multiple-ciphers'
import { extractUsage, getOpenRouter, getSttModel, providerBody } from './openrouter'
import { isBudgetExceeded, logUsage } from './budget'

/**
 * Diktat-Transkription über ein Audio-Input-Chat-Modell auf OpenRouter
 * (input_audio im Chat-Completions-Format). Gibt NUR das Transkript zurück.
 */
export async function transcribeAudio(
  db: Database.Database,
  audioBase64: string,
  format: 'wav' | 'mp3'
): Promise<string> {
  const client = getOpenRouter()
  if (!client) throw new Error('Kein OpenRouter-Key hinterlegt (⌘, Einstellungen)')
  if (isBudgetExceeded(db)) throw new Error('AI-Budget erschöpft')

  const model = getSttModel()
  const completion = await client.chat.completions.create({
    ...providerBody(),
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transkribiere diese Sprachaufnahme wortgetreu in ihrer Originalsprache. Gib AUSSCHLIESSLICH das Transkript aus — keine Anführungszeichen, keine Kommentare, keine Übersetzung. Ist keine oder nur unverständliche Sprache zu hören, gib exakt [LEER] aus.'
          },
          {
            type: 'input_audio',
            input_audio: { data: audioBase64, format }
          }
        ] as never
      }
    ],
    temperature: 0,
    max_tokens: 2000
  })
  const usage = completion.usage
  if (usage) {
    const { inputTokens, outputTokens, costUsd } = extractUsage(usage)
    logUsage(db, model, inputTokens, outputTokens, costUsd)
  }
  const text = completion.choices[0]?.message?.content?.trim() ?? ''
  // [LEER] = Modell hat nichts Verwertbares gehört → leeres Transkript,
  // der Aufrufer zeigt dann einen verständlichen Hinweis statt Modell-Prosa
  if (text === '[LEER]' || /^\[LEER\]$/i.test(text)) return ''
  return text
}
