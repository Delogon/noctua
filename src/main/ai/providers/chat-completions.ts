import { toFile } from 'openai'
import { extractUsage, providerBody } from '../openrouter'
import { listOpenRouterCatalog } from '../models'
import { createOpenAiClient } from './openai-factory'
import { fetchOpenAiModels } from './models-list'
import {
  OPENROUTER_BASE_URL,
  type AiProfile,
  type LlmClient,
  type LlmRequest,
  type LlmResult,
  type LlmUsage
} from './types'

export interface AdapterOptions {
  profile: AiProfile
  apiKey: string | null
}

/** OpenRouter-Zusatzheader (Attribution) — nur beim OpenRouter-Preset. */
export const OPENROUTER_HEADERS = {
  'HTTP-Referer': 'https://github.com/Schereo/noctua',
  'X-Title': 'Noctua'
}

/** Kosten nur bei OpenRouter (Preis-Fallback inklusive); sonst immer 0. */
export function mapUsage(usage: unknown, priced: boolean): LlmUsage {
  const u = extractUsage(usage)
  return priced ? u : { inputTokens: u.inputTokens, outputTokens: u.outputTokens, costUsd: 0 }
}

/** Fallback-Schätzung, falls ein Stream keine Usage liefert (~4 Zeichen/Token). */
export function estimateStreamUsage(chars: number, priced: boolean): LlmUsage {
  const outputTokens = Math.ceil(chars / 4)
  return { inputTokens: 0, outputTokens, costUsd: priced ? (outputTokens * 25) / 1_000_000 : 0 }
}

/** Whisper-kompatibel: POST /audio/transcriptions (whisper.cpp, faster-whisper, LocalAI …). */
export async function transcribeViaWhisper(
  client: ReturnType<typeof createOpenAiClient>,
  audioBase64: string,
  format: 'wav' | 'mp3',
  model: string
): Promise<LlmResult> {
  const file = await toFile(Buffer.from(audioBase64, 'base64'), `audio.${format}`, {
    type: format === 'wav' ? 'audio/wav' : 'audio/mpeg'
  })
  const res = await client.audio.transcriptions.create({ file, model })
  return { text: (res.text ?? '').trim(), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }
}

const TRANSCRIBE_PROMPT =
  'Transkribiere diese Sprachaufnahme wortgetreu in ihrer Originalsprache. Gib AUSSCHLIESSLICH das Transkript aus — keine Anführungszeichen, keine Kommentare, keine Übersetzung. Ist keine oder nur unverständliche Sprache zu hören, gib exakt [LEER] aus.'

/** Adapter für OpenAI Chat Completions (`chat.completions.create`). */
export function createChatCompletionsClient({ profile, apiKey }: AdapterOptions): LlmClient {
  const openrouter = profile.preset === 'openrouter'
  const client = createOpenAiClient({
    baseUrl: profile.baseUrl || OPENROUTER_BASE_URL,
    apiKey,
    headers: openrouter ? OPENROUTER_HEADERS : undefined
  })

  function body(req: LlmRequest): Record<string, unknown> {
    return {
      // ZDR-Routing (`provider`) ist eine OpenRouter-Erweiterung
      ...(openrouter ? providerBody() : {}),
      model: req.model,
      messages: req.messages,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.json ? { response_format: { type: 'json_object' } } : {})
    }
  }

  return {
    async complete(req, opts) {
      const response = await client.chat.completions.create(
        {
          ...body(req),
          // OpenRouter: Kosten in der Response mitliefern
          ...(openrouter ? { usage: { include: true } } : {})
        } as never,
        { signal: opts?.signal }
      )
      const r = response as {
        choices?: Array<{ message?: { content?: string | null } }>
        usage?: unknown
      }
      return {
        text: r.choices?.[0]?.message?.content ?? '',
        usage: mapUsage(r.usage, openrouter)
      }
    },

    async stream(req, onDelta, opts) {
      const stream = (await client.chat.completions.create(
        { ...body(req), stream: true, stream_options: { include_usage: true } } as never,
        { signal: opts?.signal }
      )) as unknown as AsyncIterable<{
        choices?: Array<{ delta?: { content?: string | null } }>
        usage?: unknown
      }>
      let text = ''
      let usage: LlmUsage | null = null
      for await (const part of stream) {
        const delta = part.choices?.[0]?.delta?.content ?? ''
        if (delta) {
          text += delta
          onDelta(delta)
        }
        if (part.usage) usage = mapUsage(part.usage, openrouter)
      }
      return { text, usage: usage ?? estimateStreamUsage(text.length, openrouter) }
    },

    async listModels() {
      return openrouter ? listOpenRouterCatalog() : fetchOpenAiModels(profile.baseUrl, apiKey)
    },

    async transcribe(audioBase64, format, model) {
      if (!openrouter) return transcribeViaWhisper(client, audioBase64, format, model)
      // OpenRouter kennt kein /audio/transcriptions — Audio-Input-Chat wie bisher
      const completion = await client.chat.completions.create({
        ...providerBody(),
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: TRANSCRIBE_PROMPT },
              { type: 'input_audio', input_audio: { data: audioBase64, format } }
            ] as never
          }
        ],
        temperature: 0,
        max_tokens: 2000
      })
      return {
        text: completion.choices[0]?.message?.content?.trim() ?? '',
        usage: mapUsage(completion.usage, true)
      }
    }
  }
}
