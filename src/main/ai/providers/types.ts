// Provider-Abstraktion für alle AI-Aufrufe: ein Profil (Endpunkt) + ein
// LlmClient, der je nach API-Stil Chat Completions oder Responses spricht.

export type ApiStyle = 'chat' | 'responses'
export type ProfilePreset = 'openrouter' | 'custom'
/** `decision`: Entscheidungsmodell (Ollama System One), optional und nur lokal sinnvoll */
export type AiTask = 'triage' | 'draft' | 'stt' | 'decision'

export const OPENROUTER_PROFILE_ID = 'openrouter'
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'

export interface AiProfile {
  id: string
  name: string
  baseUrl: string
  apiStyle: ApiStyle
  /** lokal/On-Prem (true) oder externer Dienst (false) — Grundlage für „Local only" */
  isLocal: boolean
  preset: ProfilePreset
  /** von der Organisation (Org-Konfiguration) bereitgestellt: URL/Stil/Name gesperrt, nur der Key editierbar */
  managed: boolean
  /** Key im Vault hinterlegt (der Key selbst verlässt den Main-Prozess nie) */
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
  /** JSON-Modus — Call-Sites setzen es nur dort, wo sie es schon vorher taten */
  json?: boolean
}

export interface LlmUsage {
  inputTokens: number
  outputTokens: number
  /** nur bei OpenRouter aussagekräftig, sonst 0 */
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
  /** nimmt Audio als Input (Diktat-Transkription) */
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
   * Nur Clients, die Audio können; sonst fehlt die Methode. Liefert das rohe
   * Transkript samt Usage (bei OpenRouter fallen Kosten an).
   */
  transcribe?(audioBase64: string, format: 'wav' | 'mp3', model: string): Promise<LlmResult>
}

export interface ResolvedTask {
  client: LlmClient
  model: string
  profile: AiProfile
}
