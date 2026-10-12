import { isLocalOnly } from '../privacy'
import { getClient, getProfile } from './providers/registry'

// Function test for freely chosen OpenRouter models (M86): sends a
// sample mail through a triage-shaped prompt and checks whether structured
// JSON comes back. Deliberately the same task shape as the real scanner —
// if a model passes the test, it can also sort the inbox.

const TEST_SYSTEM =
  'You sort emails. Reply ONLY with a JSON object of the form ' +
  '{"category":"work|personal|newsletter|other","priority":1-5} — no other text.'

const TEST_MAIL =
  'From: anna@example.org\nSubject: Quote by Friday\n\n' +
  'Hi, could you send me the revised quote by Friday? Thanks!'

export interface ModelTestResult {
  ok: boolean
  latencyMs: number
  costUsd: number | null
  /** Failure reason or excerpt of the unusable answer — null on success. */
  detail: string | null
}

/** Pure verdict on the model answer — testable separately. */
export function evaluateTestReply(raw: string): { ok: boolean; detail: string | null } {
  // Tolerate code fences and surrounding text, then grab the first JSON object
  const match = raw.match(/\{[\s\S]*?\}/)
  if (!match) {
    return { ok: false, detail: `Antwort war kein JSON: „${raw.trim().slice(0, 120)}“` }
  }
  try {
    const parsed = JSON.parse(match[0]) as { category?: unknown; priority?: unknown }
    const priority = Number(parsed.priority)
    if (typeof parsed.category !== 'string' || !parsed.category.trim()) {
      return { ok: false, detail: 'JSON ohne brauchbares category-Feld' }
    }
    if (!Number.isFinite(priority) || priority < 1 || priority > 5) {
      return { ok: false, detail: 'JSON ohne priority zwischen 1 und 5' }
    }
    return { ok: true, detail: null }
  } catch {
    return { ok: false, detail: `JSON nicht parsebar: „${match[0].slice(0, 120)}“` }
  }
}

export async function runModelTest(profileId: string, model: string): Promise<ModelTestResult> {
  const profile = getProfile(profileId)
  if (!profile) return { ok: false, latencyMs: 0, costUsd: null, detail: 'Anbieter nicht gefunden' }
  if (isLocalOnly() && !profile.isLocal) {
    return {
      ok: false,
      latencyMs: 0,
      costUsd: null,
      detail: '„Nur lokal“ ist aktiv – externe Anbieter werden nicht angefragt'
    }
  }
  if (profile.preset === 'openrouter' && !profile.hasKey) {
    return {
      ok: false,
      latencyMs: 0,
      costUsd: null,
      detail: 'Kein OpenRouter-Schlüssel hinterlegt'
    }
  }
  const started = Date.now()
  try {
    const result = await getClient(profile).complete({
      model,
      messages: [
        { role: 'system', content: TEST_SYSTEM },
        { role: 'user', content: TEST_MAIL }
      ],
      temperature: 0,
      maxTokens: 200
    })
    const latencyMs = Date.now() - started
    const verdict = evaluateTestReply(result.text)
    // Costs only exist for priced (OpenRouter) profiles
    const costUsd = profile.preset === 'openrouter' ? result.usage.costUsd : null
    return { ok: verdict.ok, latencyMs, costUsd, detail: verdict.detail }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      costUsd: null,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}

export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  modelCount: number
  detail: string | null
}

/**
 * Connection test: fetch the profile's model list. Deliberately allowed for
 * external profiles even under Local only — it is an explicit user action without
 * mail contents, not an automatic request.
 */
export async function testProfileConnection(profileId: string): Promise<ConnectionTestResult> {
  const profile = getProfile(profileId)
  if (!profile) return { ok: false, latencyMs: 0, modelCount: 0, detail: 'Anbieter nicht gefunden' }
  const started = Date.now()
  try {
    const models = await getClient(profile).listModels()
    return { ok: true, latencyMs: Date.now() - started, modelCount: models.length, detail: null }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      modelCount: 0,
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}
