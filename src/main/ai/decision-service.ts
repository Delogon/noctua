import type Database from 'better-sqlite3-multiple-ciphers'
import { PHISHING_SCORE_HIGH } from '@shared/decision-thresholds'
import { isLocalOnly } from '../privacy'
import { getSecret } from '../auth/secrets'
import { getClient, getProfile, profileSecretKey } from './providers/registry'
import { getOllamaModelCaps, isDecisionCapable, isDecisionOnly } from './providers/ollama-caps'
import { decide, scoreOf, noulOf, type Questions } from './providers/systemone'
import type { AiProfile, ModelInfo } from './providers/types'

/**
 * Modellliste eines Profils für die Picker. 'chat' (Standard) schließt reine
 * Entscheidungsmodelle aus – sie würden im Chat nur Fehler liefern. 'decision'
 * liefert ausschließlich Modelle mit der Fähigkeit `decision` (nur Ollama;
 * andere Server ergeben eine leere Liste, der Freitext bleibt möglich).
 */
export async function listProfileModels(
  profile: AiProfile,
  kind: 'chat' | 'decision'
): Promise<ModelInfo[]> {
  const apiKey = getSecret(profileSecretKey(profile))
  if (kind === 'decision') {
    if (profile.preset === 'openrouter') return []
    const caps = await getOllamaModelCaps(profile.baseUrl, { apiKey })
    return caps
      .filter((m) => isDecisionCapable(m.capabilities))
      .map((m) => ({ id: m.name, promptPerM: 0, completionPerM: 0, context: 0, audioIn: false }))
      .sort((a, b) => a.id.localeCompare(b.id))
  }
  const models = await getClient(profile).listModels()
  // Fähigkeiten nur bei lokalen Profilen erfragen – kein zusätzlicher Request an externe Hosts
  if (profile.preset === 'openrouter' || !profile.isLocal) return models
  const caps = await getOllamaModelCaps(profile.baseUrl, { apiKey })
  return excludeDecisionOnly(models, caps)
}

/** Reine Entscheidungsmodelle aus einer Chat-Modellliste entfernen. */
export function excludeDecisionOnly(
  models: ModelInfo[],
  caps: Array<{ name: string; capabilities: string[] | null }>
): ModelInfo[] {
  const blocked = new Set(caps.filter((m) => isDecisionOnly(m.capabilities)).map((m) => m.name))
  return models.filter((m) => !blocked.has(m.id))
}

export interface DecisionTestResult {
  ok: boolean
  latencyMs: number
  detail: string | null
  answers: Array<{ name: string; text: string }>
}

const TEST_QUESTIONS: Questions = {
  invoice: {
    type: 'noul',
    instructions: 'Ist das eine Rechnung?',
    criteria: { false: 'Keine Rechnung', true: 'Eine Rechnung' }
  },
  urgency: {
    type: 'score',
    instructions: 'Wie dringend ist diese E-Mail?',
    criteria: ['Routine: keine Eile', 'Bald: Frist in Sicht', 'Sofort: Frist läuft ab']
  }
}
const TEST_STATE =
  'Betreff: Rechnung Nr. 4711\n\nHallo, anbei die Rechnung über 120 Euro. Bitte überweise den Betrag bis Freitag.'

/** Funktions-Test: zwei Mini-Fragen. Wie runModelTest nur gegen lokale Profile bei Local only. */
export async function runDecisionTest(
  profileId: string,
  model: string
): Promise<DecisionTestResult> {
  const fail = (detail: string, latencyMs = 0): DecisionTestResult => ({
    ok: false,
    latencyMs,
    detail,
    answers: []
  })
  const profile = getProfile(profileId)
  if (!profile) return fail('Anbieter nicht gefunden')
  if (profile.preset === 'openrouter') {
    return fail('Entscheidungsmodelle laufen nur auf lokalen Ollama-Servern')
  }
  if (isLocalOnly() && !profile.isLocal) {
    return fail('„Nur lokal“ ist aktiv – externe Anbieter werden nicht angefragt')
  }
  const started = Date.now()
  try {
    const result = await decide({
      baseUrl: profile.baseUrl,
      apiKey: getSecret(profileSecretKey(profile)),
      model,
      state: TEST_STATE,
      questions: TEST_QUESTIONS,
      timeoutMs: 90_000
    })
    const score = scoreOf(result.answers, 'urgency')
    return {
      ok: true,
      latencyMs: Date.now() - started,
      detail: null,
      answers: [
        { name: 'invoice', text: `${Math.round(noulOf(result.answers, 'invoice') * 100)} %` },
        { name: 'urgency', text: score ? `${score.score.toFixed(2)} / 2` : '–' }
      ]
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), Date.now() - started)
  }
}

/** Phishing-Einschätzung einer Mail aus ai_decisions (null ohne Entscheidungsmodell-Triage). */
export function getPhishing(
  db: Database.Database,
  messageId: number
): { score: number; high: boolean; signals: string[] } | null {
  const row = db
    .prepare('SELECT phishing, phishing_signals_json FROM ai_decisions WHERE message_id = ?')
    .get(messageId) as { phishing: number | null; phishing_signals_json: string | null } | undefined
  if (!row || row.phishing === null) return null
  let signals: string[] = []
  try {
    const parsed = JSON.parse(row.phishing_signals_json ?? '[]') as unknown
    if (Array.isArray(parsed)) {
      signals = parsed.filter((s): s is string => typeof s === 'string').slice(0, 10)
    }
  } catch {
    // keine Signale
  }
  return { score: row.phishing, high: row.phishing >= PHISHING_SCORE_HIGH, signals }
}
