import OpenAI from 'openai'

/**
 * The only place that builds OpenAI SDK clients — test seam (the tests mock
 * this module and pass a fake client through).
 */
export function createOpenAiClient(opts: {
  baseUrl: string
  apiKey: string | null
  headers?: Record<string, string>
}): OpenAI {
  return new OpenAI({
    // Local servers often need no key, but the SDK still requires a value
    apiKey: opts.apiKey || 'not-needed',
    baseURL: opts.baseUrl,
    defaultHeaders: opts.headers
  })
}
