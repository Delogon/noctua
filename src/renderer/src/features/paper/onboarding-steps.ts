// Pure step and state logic of the 4-step onboarding (Design 1b):
// welcome → connect → ai → training. Separate from rendering so that
// Enter gating, CTA enablement and row states are testable.

export type ObStep = 1 | 2 | 3 | 4

/** Display state of a training row in step 4. */
export type TrainRowState = 'idle' | 'running' | 'done' | 'failed' | 'paused'

export interface TrainRowFlags {
  running: boolean
  failed: boolean
  pct: number
}

/**
 * Derives the row state. Paused (no drafting AI) beats everything — then
 * there is neither progress nor error, only the empty track. After that:
 * failed before running before done; otherwise the row is still waiting.
 */
export function rowState(row: TrainRowFlags, paused: boolean): TrainRowState {
  if (paused) return 'paused'
  if (row.failed) return 'failed'
  if (row.running) return 'running'
  if (row.pct >= 100) return 'done'
  return 'idle'
}

/** Where the AI should run (step 3). */
export type AiChoice = 'local' | 'apple' | 'cloud' | 'skip'
export type CloudKind = 'openrouter' | 'custom'

/** What the user has set up in step 3 so far. */
export interface AiStepState {
  appleAvailable: boolean
  /** Local server: profile is set */
  localProfile: boolean
  localTriageModel: string
  localDraftModel: string
  cloudKind: CloudKind
  /** OpenRouter: key saved (or already present) */
  openrouterKey: boolean
  /** Custom cloud endpoint: profile is set */
  customProfile: boolean
  customTriageModel: string
  customDraftModel: string
}

/**
 * Is the chosen option fully set up? Skip always counts (Noctua as a pure
 * mail client); Apple only if the device supports it.
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
 * Can the style training (step 4) run? It needs a drafting AI: Apple
 * On-Device can only do triage, skip has none at all — then step 4 honestly
 * pauses.
 */
export function aiTrainingRuns(choice: AiChoice, s: AiStepState): boolean {
  return (choice === 'local' || choice === 'cloud') && aiStepReady(choice, s)
}

/** „Local only" is on by default for local options, otherwise off. */
export function localOnlyDefault(choice: AiChoice): boolean {
  return choice === 'local' || choice === 'apple'
}

/**
 * Step 3 CTA: active as soon as the chosen option is ready (skip always).
 * `train` says what the click does: start training, or continue paused
 * (Apple-only and skip).
 */
export function aiStepCta(choice: AiChoice, s: AiStepState): { enabled: boolean; train: boolean } {
  return { enabled: aiStepReady(choice, s), train: aiTrainingRuns(choice, s) }
}

/**
 * Step 4 CTA (»ENTER YOUR MAIL«): active as soon as no row is running or
 * still pending. Paused and failed rows deliberately don't block entry —
 * mail works without the owl too.
 */
export function finishCtaEnabled(states: TrainRowState[]): boolean {
  return states.every((s) => s === 'done' || s === 'failed' || s === 'paused')
}

/**
 * Boot decision at app start: what happens with the onboarding?
 * - `none`: already completed.
 * - `resume`: onboarding was already running (started flag) and was
 *   interrupted by a restart/reload — resume, even if accounts are connected.
 *   Previously the existing-accounts heuristic swallowed this case: whoever
 *   restarted mid-flow was never asked about the AI.
 * - `legacyMarkOnboarded`: accounts exist, but onboarding never ran —
 *   an installation from before the onboarding, silently mark it as done.
 * - `show`: real first start.
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

/** What Enter does outside an input on the current step. */
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
    /** Step 3 CTA active (chosen option fully set up) */
    aiReady: boolean
    /** After step 3 the training runs (drafting AI available) */
    aiTrains: boolean
    /** Chosen option is „Überspringen" */
    aiSkip: boolean
    rowStates: TrainRowState[]
  }
): EnterAction {
  if (step === 1) return { kind: 'to-connect' }
  if (step === 2) return ctx.connectedCount > 0 ? { kind: 'to-key' } : { kind: 'toast-connect-one' }
  // Step 3: Enter only advances when the chosen option is ready.
  // „Überspringen" is chosen deliberately by click — never by Enter reflex.
  if (step === 3) {
    if (!ctx.aiReady || ctx.aiSkip) return null
    return { kind: ctx.aiTrains ? 'to-training' : 'to-training-paused' }
  }
  return finishCtaEnabled(ctx.rowStates) ? { kind: 'finish' } : null
}
