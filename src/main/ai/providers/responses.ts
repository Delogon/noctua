import { createOpenAiClient } from './openai-factory'
import { fetchOpenAiModels } from './models-list'
import { estimateStreamUsage, transcribeViaWhisper, type AdapterOptions } from './chat-completions'
import type { LlmClient, LlmMessage, LlmRequest, LlmUsage } from './types'

interface ResponsesUsage {
  input_tokens?: number
  output_tokens?: number
}

/** Responses-Usage → einheitliche Form; Kosten gibt es hier nie (kein OpenRouter-Pfad). */
export function mapResponsesUsage(usage: ResponsesUsage | null | undefined): LlmUsage {
  return {
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    costUsd: 0
  }
}

function plainText(content: LlmMessage['content']): string {
  if (typeof content === 'string') return content
  return content.map((p) => (p.type === 'text' ? p.text : '')).join('')
}

/**
 * System-Nachrichten wandern in `instructions`, der Rest als Input-Items.
 * Bleibt nur eine User-Nachricht übrig, geht sie als einfacher String durch.
 */
export function toResponsesInput(messages: LlmMessage[]): {
  instructions: string | undefined
  input: string | Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => plainText(m.content))
    .filter(Boolean)
  const rest = messages.filter((m) => m.role !== 'system')
  const input =
    rest.length === 1 && rest[0].role === 'user'
      ? plainText(rest[0].content)
      : rest.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: plainText(m.content)
        }))
  return { instructions: system.length > 0 ? system.join('\n\n') : undefined, input }
}

/** Adapter für OpenAI Responses (`responses.create`). */
export function createResponsesClient({ profile, apiKey }: AdapterOptions): LlmClient {
  const client = createOpenAiClient({ baseUrl: profile.baseUrl, apiKey })

  function body(req: LlmRequest): Record<string, unknown> {
    const { instructions, input } = toResponsesInput(req.messages)
    return {
      model: req.model,
      ...(instructions ? { instructions } : {}),
      input,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { max_output_tokens: req.maxTokens } : {}),
      ...(req.json ? { text: { format: { type: 'json_object' } } } : {}),
      // Kein Server-seitiges Aufbewahren der Mail-Inhalte
      store: false
    }
  }

  return {
    async complete(req, opts) {
      const response = (await client.responses.create(body(req) as never, {
        signal: opts?.signal
      })) as unknown as {
        output_text?: string
        output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
        usage?: ResponsesUsage
      }
      // `output_text` ist ein SDK-Convenience-Feld; sonst aus den Items zusammensetzen
      const text =
        response.output_text ??
        (response.output ?? [])
          .filter((item) => item.type === 'message')
          .flatMap((item) => item.content ?? [])
          .filter((part) => part.type === 'output_text')
          .map((part) => part.text ?? '')
          .join('')
      return { text, usage: mapResponsesUsage(response.usage) }
    },

    async stream(req, onDelta, opts) {
      const events = (await client.responses.create({ ...body(req), stream: true } as never, {
        signal: opts?.signal
      })) as unknown as AsyncIterable<{
        type: string
        delta?: string
        message?: string
        response?: { usage?: ResponsesUsage; error?: { message?: string } | null }
      }>
      let text = ''
      let usage: LlmUsage | null = null
      for await (const event of events) {
        if (event.type === 'response.output_text.delta' && event.delta) {
          text += event.delta
          onDelta(event.delta)
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          if (event.response?.usage) usage = mapResponsesUsage(event.response.usage)
        } else if (event.type === 'response.failed') {
          throw new Error(event.response?.error?.message ?? 'Responses-Anfrage fehlgeschlagen')
        } else if (event.type === 'error') {
          throw new Error(event.message ?? 'Responses-Stream-Fehler')
        }
      }
      return { text, usage: usage ?? estimateStreamUsage(text.length, false) }
    },

    listModels: () => fetchOpenAiModels(profile.baseUrl, apiKey),

    transcribe: (audioBase64, format, model) =>
      transcribeViaWhisper(client, audioBase64, format, model)
  }
}
