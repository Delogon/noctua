// Reine Schritt- und Zustandslogik des 4-Schritte-Onboardings (Design 1b):
// welcome → connect → ai → training. Vom Rendering getrennt, damit
// Enter-Gating, CTA-Freischaltung und Zeilen-Zustände testbar sind.

export type ObStep = 1 | 2 | 3 | 4

/** Anzeige-Zustand einer Trainingszeile in Schritt 4. */
export type TrainRowState = 'idle' | 'running' | 'done' | 'failed' | 'paused'

export interface TrainRowFlags {
  running: boolean
  failed: boolean
  pct: number
}

/**
 * Leitet den Zeilen-Zustand ab. Pausiert (keine Entwurfs-KI) schlägt alles —
 * dann gibt es weder Fortschritt noch Fehler, nur die leere Spur. Danach
 * gilt: gescheitert vor laufend vor fertig; sonst wartet die Zeile noch.
 */
export function rowState(row: TrainRowFlags, paused: boolean): TrainRowState {
  if (paused) return 'paused'
  if (row.failed) return 'failed'
  if (row.running) return 'running'
  if (row.pct >= 100) return 'done'
  return 'idle'
}

/** Wo die KI laufen soll (Schritt 3). */
export type AiChoice = 'local' | 'apple' | 'cloud' | 'skip'
export type CloudKind = 'openrouter' | 'custom'

/** Was der Nutzer in Schritt 3 bisher eingerichtet hat. */
export interface AiStepState {
  appleAvailable: boolean
  /** Lokaler Server: Profil steht */
  localProfile: boolean
  localTriageModel: string
  localDraftModel: string
  cloudKind: CloudKind
  /** OpenRouter: Schlüssel gespeichert (oder schon vorhanden) */
  openrouterKey: boolean
  /** Eigener Cloud-Endpunkt: Profil steht */
  customProfile: boolean
  customTriageModel: string
  customDraftModel: string
}

/**
 * Ist die gewählte Option vollständig eingerichtet? Überspringen gilt immer
 * (Noctua als reiner Mail-Client); Apple nur, wenn das Gerät es kann.
 */
export function aiStepReady(choice: AiChoice, s: AiStepState): boolean {
  switch (choice) {
    case 'skip':
      return true
    case 'apple':
      return s.appleAvailable
    case 'local':
      return s.localProfile && s.localTriageModel !== '' && s.localDraftModel !== ''
    case 'cloud':
      return s.cloudKind === 'openrouter'
        ? s.openrouterKey
        : s.customProfile && s.customTriageModel !== '' && s.customDraftModel !== ''
  }
}

/**
 * Kann das Stil-Training (Schritt 4) laufen? Es braucht eine Entwurfs-KI:
 * Apple On-Device kann nur Triage, Überspringen hat gar keine — dann pausiert
 * Schritt 4 ehrlich.
 */
export function aiTrainingRuns(choice: AiChoice, s: AiStepState): boolean {
  return (choice === 'local' || choice === 'cloud') && aiStepReady(choice, s)
}

/** „Local only" ist bei lokalen Optionen standardmäßig an, sonst aus. */
export function localOnlyDefault(choice: AiChoice): boolean {
  return choice === 'local' || choice === 'apple'
}

/**
 * Schritt-3-CTA: aktiv, sobald die gewählte Option fertig ist (Überspringen
 * immer). `train` sagt, was der Klick tut: Training starten, oder pausiert
 * weiter (Apple-only und Überspringen).
 */
export function aiStepCta(choice: AiChoice, s: AiStepState): { enabled: boolean; train: boolean } {
  return { enabled: aiStepReady(choice, s), train: aiTrainingRuns(choice, s) }
}

/**
 * Schritt-4-CTA (»ENTER YOUR MAIL«): aktiv, sobald keine Zeile mehr läuft
 * oder noch ansteht. Pausierte und gescheiterte Zeilen blockieren den
 * Einstieg bewusst nicht — Mail funktioniert auch ohne Eule.
 */
export function finishCtaEnabled(states: TrainRowState[]): boolean {
  return states.every((s) => s === 'done' || s === 'failed' || s === 'paused')
}

/**
 * Boot-Entscheidung beim App-Start: Was passiert mit dem Onboarding?
 * - `none`: schon abgeschlossen.
 * - `resume`: Onboarding lief bereits (Started-Flag) und wurde durch Neustart/
 *   Reload unterbrochen — fortsetzen, auch wenn schon Konten verbunden sind.
 *   Vorher schluckte die Bestandskonten-Heuristik diesen Fall: Wer mitten im
 *   Flow neu startete, wurde nie nach der KI gefragt.
 * - `legacyMarkOnboarded`: Konten existieren, aber das Onboarding lief nie —
 *   Bestandsinstallation von vor dem Onboarding, still als erledigt markieren.
 * - `show`: echter Erststart.
 */
export type OnboardingBootDecision = 'none' | 'show' | 'resume' | 'legacyMarkOnboarded'

export function onboardingBootDecision(ctx: {
  onboarded: boolean
  started: boolean
  accountCount: number
}): OnboardingBootDecision {
  if (ctx.onboarded) return 'none'
  if (ctx.started) return 'resume'
  if (ctx.accountCount > 0) return 'legacyMarkOnboarded'
  return 'show'
}

/** Was Enter außerhalb eines Inputs auf dem aktuellen Schritt bewirkt. */
export type EnterAction =
  | { kind: 'to-connect' }
  | { kind: 'toast-connect-one' }
  | { kind: 'to-key' }
  | { kind: 'to-training' }
  | { kind: 'to-training-paused' }
  | { kind: 'finish' }
  | null

export function enterAction(
  step: ObStep,
  ctx: {
    connectedCount: number
    /** Schritt-3-CTA aktiv (gewählte Option fertig eingerichtet) */
    aiReady: boolean
    /** Nach Schritt 3 läuft das Training (Entwurfs-KI vorhanden) */
    aiTrains: boolean
    /** Gewählte Option ist „Überspringen" */
    aiSkip: boolean
    rowStates: TrainRowState[]
  }
): EnterAction {
  if (step === 1) return { kind: 'to-connect' }
  if (step === 2) return ctx.connectedCount > 0 ? { kind: 'to-key' } : { kind: 'toast-connect-one' }
  // Schritt 3: Enter geht nur weiter, wenn die gewählte Option fertig ist.
  // „Überspringen" wählt man bewusst per Klick — nie per Enter-Reflex.
  if (step === 3) {
    if (!ctx.aiReady || ctx.aiSkip) return null
    return { kind: ctx.aiTrains ? 'to-training' : 'to-training-paused' }
  }
  return finishCtaEnabled(ctx.rowStates) ? { kind: 'finish' } : null
}
