import OpenAI from 'openai'

/**
 * Einzige Stelle, die OpenAI-SDK-Clients baut — Test-Naht (die Tests mocken
 * dieses Modul und reichen einen Fake-Client durch).
 */
export function createOpenAiClient(opts: {
  baseUrl: string
  apiKey: string | null
  headers?: Record<string, string>
}): OpenAI {
  return new OpenAI({
    // Lokale Server brauchen oft keinen Key; das SDK verlangt aber einen Wert
    apiKey: opts.apiKey || 'not-needed',
    baseURL: opts.baseUrl,
    defaultHeaders: opts.headers
  })
}
