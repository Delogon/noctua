// Provider abstraction for all AI calls: a profile (endpoint) + an
// LlmClient that speaks Chat Completions or Responses depending on the API style.

export type ApiStyle = 'chat' | 'responses'
export type ProfilePreset = 'openrouter' | 'custom'
/** `decision`: decision model (Ollama System One), optional and only useful locally */
export type AiTask = 'triage' | 'draft' | 'stt' | 'decision'

export const OPENROUTER_PROFILE_ID = 'openrouter'
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface AiProfile {
  id: string
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  /** local/on-prem (true) or external service (false) — basis for "Local only" */
  isLocal: boolean
  preset: ProfilePreset
  /** provided by the organization (org config): URL/style/name locked, only the key editable */
  managed: boolean
  /** key stored in the vault (the key itself never leaves the main process) */
  hasKey: boolean
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'input_audio'; input_audio: { data: string; format: 'wav' | 'mp3' } }

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export interface LlmRequest {
  model: string
  messages: LlmMessage[]
  temperature?: number
  maxTokens?: number
  /** JSON mode — call sites set it only where they already did before */
  json?: boolean
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  /** only meaningful for OpenRouter, otherwise 0 */
  costUsd: number
}

export interface LlmResult {
  text: string
  usage: LlmUsage
}

export interface ModelInfo {
  id: string
  promptPerM: number
  completionPerM: number
  context: number
  /** accepts audio as input (dictation transcription) */
  audioIn: boolean
}

export interface CallOptions {
  signal?: AbortSignal
}

export interface LlmClient {
  complete(req: LlmRequest, opts?: CallOptions): Promise<LlmResult>
  stream(req: LlmRequest, onDelta: (text: string) => void, opts?: CallOptions): Promise<LlmResult>
  listModels(): Promise<ModelInfo[]>
  /**
   * Only on clients that can handle audio; otherwise the method is absent. Returns
   * the raw transcript plus usage (OpenRouter incurs costs).
   */
  transcribe?(audioBase64: string, format: 'wav' | 'mp3', model: string): Promise<LlmResult>
}

export interface ResolvedTask {
  client: LlmClient
  model: string
  profile: AiProfile
}
