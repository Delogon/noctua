import { isLocalOnly } from '../privacy'
import { getClient, getProfile } from './providers/registry'

// Funktions-Test für frei gewählte OpenRouter-Modelle (M86): schickt eine
// Beispiel-Mail durch einen triage-förmigen Prompt und prüft, ob strukturiertes
// JSON zurückkommt. Bewusst dieselbe Aufgabenform wie der echte Scanner —
// besteht ein Modell den Test, kann es auch den Posteingang sortieren.

const TEST_SYSTEM =
  'Du sortierst E-Mails. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt der Form ' +
  '{"category":"work|personal|newsletter|other","priority":1-5} — kein weiterer Text.'

const TEST_MAIL =
  'Von: anna@beispiel.de\nBetreff: Angebot bis Freitag\n\n' +
  'Hallo, kannst du mir bis Freitag das überarbeitete Angebot schicken? Danke!'

export interface ModelTestResult {
  ok: boolean
  latencyMs: number
  costUsd: number | null
  /** Fehlergrund bzw. Auszug der unbrauchbaren Antwort — null bei Erfolg. */
  detail: string | null
}

/** Pures Urteil über die Modell-Antwort — separat testbar. */
export function evaluateTestReply(raw: string): { ok: boolean; detail: string | null } {
  // Codefences und Umgebungstext tolerieren, dann das erste JSON-Objekt greifen
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
  if (!profile) return { ok: false, latencyMs: 0, costUsd: null, detail: 'Profil nicht gefunden' }
  if (isLocalOnly() && !profile.isLocal) {
    return {
      ok: false,
      latencyMs: 0,
      costUsd: null,
      detail: 'Local only ist aktiv — externe Profile werden nicht angesprochen'
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
    // Kosten gibt es nur bei bepreisten (OpenRouter-)Profilen
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
 * Verbindungstest: Modellliste des Profils holen. Bewusst auch bei Local only
 * für externe Profile erlaubt — es ist eine ausdrückliche Nutzeraktion ohne
 * Mail-Inhalte, kein automatischer Request.
 */
export async function testProfileConnection(profileId: string): Promise<ConnectionTestResult> {
  const profile = getProfile(profileId)
  if (!profile) return { ok: false, latencyMs: 0, modelCount: 0, detail: 'Profil nicht gefunden' }
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
