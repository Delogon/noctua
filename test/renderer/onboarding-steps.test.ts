import { describe, expect, it } from 'vitest'
import {
  aiStepCta,
  aiStepReady,
  aiTrainingRuns,
  enterAction,
  finishCtaEnabled,
  localOnlyDefault,
  onboardingBootDecision,
  rowState,
  type AiStepState,
  type TrainRowFlags,
  type TrainRowState
} from '@renderer/features/paper/onboarding-steps'

describe('onboardingBootDecision', () => {
  it('abgeschlossenes Onboarding gewinnt immer', () => {
    expect(onboardingBootDecision({ onboarded: true, started: true, accountCount: 3 })).toBe('none')
    expect(onboardingBootDecision({ onboarded: true, started: false, accountCount: 0 })).toBe(
      'none'
    )
  })

  it('echter Erststart zeigt das Onboarding', () => {
    expect(onboardingBootDecision({ onboarded: false, started: false, accountCount: 0 })).toBe(
      'show'
    )
  })

  it('Neustart mitten im Flow setzt fort — auch mit schon verbundenem Konto', () => {
    expect(onboardingBootDecision({ onboarded: false, started: true, accountCount: 1 })).toBe(
      'resume'
    )
    expect(onboardingBootDecision({ onboarded: false, started: true, accountCount: 0 })).toBe(
      'resume'
    )
  })

  it('Bestandskonten ohne je gestarteten Flow werden still als onboarded markiert', () => {
    expect(onboardingBootDecision({ onboarded: false, started: false, accountCount: 2 })).toBe(
      'legacyMarkOnboarded'
    )
  })
})

function row(overrides: Partial<TrainRowFlags> = {}): TrainRowFlags {
  return { running: false, failed: false, pct: 0, ...overrides }
}

describe('rowState', () => {
  it('pausiert schlaegt alles — auch Fehler und Fortschritt', () => {
    expect(rowState(row(), true)).toBe('paused')
    expect(rowState(row({ failed: true }), true)).toBe('paused')
    expect(rowState(row({ running: true, pct: 48 }), true)).toBe('paused')
    expect(rowState(row({ pct: 100 }), true)).toBe('paused')
  })

  it('gescheitert gewinnt vor laufend und fertig', () => {
    expect(rowState(row({ failed: true }), false)).toBe('failed')
    expect(rowState(row({ failed: true, pct: 100 }), false)).toBe('failed')
  })

  it('laufend, solange das Intervall tickt', () => {
    expect(rowState(row({ running: true, pct: 0 }), false)).toBe('running')
    expect(rowState(row({ running: true, pct: 92 }), false)).toBe('running')
  })

  it('fertig erst ab 100 Prozent, davor wartet die Zeile', () => {
    expect(rowState(row({ pct: 100 }), false)).toBe('done')
    expect(rowState(row({ pct: 99 }), false)).toBe('idle')
    expect(rowState(row(), false)).toBe('idle')
  })
})

const NONE: AiStepState = {
  appleAvailable: false,
  localProfile: false,
  localTriageModel: '',
  localDraftModel: '',
  cloudKind: 'openrouter',
  openrouterKey: false,
  customProfile: false,
  customTriageModel: '',
  customDraftModel: ''
}
const st = (o: Partial<AiStepState> = {}): AiStepState => ({ ...NONE, ...o })

describe('aiStepReady', () => {
  it('Überspringen ist immer gültig', () => {
    expect(aiStepReady('skip', st())).toBe(true)
  })

  it('lokaler Server: Profil und beide Modelle nötig', () => {
    expect(aiStepReady('local', st())).toBe(false)
    expect(aiStepReady('local', st({ localProfile: true }))).toBe(false)
    expect(aiStepReady('local', st({ localProfile: true, localTriageModel: 'a' }))).toBe(false)
    expect(
      aiStepReady('local', st({ localProfile: true, localTriageModel: 'a', localDraftModel: 'b' }))
    ).toBe(true)
    // Modelle allein ohne Profil genügen nicht
    expect(aiStepReady('local', st({ localTriageModel: 'a', localDraftModel: 'b' }))).toBe(false)
  })

  it('Apple On-Device nur, wenn verfügbar', () => {
    expect(aiStepReady('apple', st())).toBe(false)
    expect(aiStepReady('apple', st({ appleAvailable: true }))).toBe(true)
  })

  it('Cloud/OpenRouter: Schlüssel genügt (Modelle haben Defaults)', () => {
    expect(aiStepReady('cloud', st())).toBe(false)
    expect(aiStepReady('cloud', st({ openrouterKey: true }))).toBe(true)
    // Ein Local-Profil zählt nicht für die Cloud-Option
    expect(aiStepReady('cloud', st({ localProfile: true }))).toBe(false)
  })

  it('Cloud/eigener Endpunkt: Profil und beide Modelle, der OpenRouter-Key zählt nicht', () => {
    const custom = st({ cloudKind: 'custom', openrouterKey: true })
    expect(aiStepReady('cloud', custom)).toBe(false)
    expect(aiStepReady('cloud', { ...custom, customProfile: true })).toBe(false)
    expect(
      aiStepReady('cloud', {
        ...custom,
        customProfile: true,
        customTriageModel: 'x',
        customDraftModel: 'y'
      })
    ).toBe(true)
  })
})

describe('aiTrainingRuns / aiStepCta', () => {
  const local = st({ localProfile: true, localTriageModel: 'a', localDraftModel: 'b' })

  it('Training läuft nur mit Entwurfs-KI (lokal oder Cloud, fertig eingerichtet)', () => {
    expect(aiTrainingRuns('local', local)).toBe(true)
    expect(aiTrainingRuns('local', st())).toBe(false)
    expect(aiTrainingRuns('cloud', st({ openrouterKey: true }))).toBe(true)
    expect(aiTrainingRuns('apple', st({ appleAvailable: true }))).toBe(false)
    expect(aiTrainingRuns('skip', local)).toBe(false)
  })

  it('CTA: Überspringen aktiv aber pausiert, Apple aktiv aber pausiert', () => {
    expect(aiStepCta('skip', st())).toEqual({ enabled: true, train: false })
    expect(aiStepCta('apple', st({ appleAvailable: true }))).toEqual({
      enabled: true,
      train: false
    })
    expect(aiStepCta('local', local)).toEqual({ enabled: true, train: true })
    expect(aiStepCta('local', st())).toEqual({ enabled: false, train: false })
    expect(aiStepCta('cloud', st())).toEqual({ enabled: false, train: false })
  })
})

describe('localOnlyDefault', () => {
  it('an bei lokal und Apple, aus bei Cloud und Überspringen', () => {
    expect(localOnlyDefault('local')).toBe(true)
    expect(localOnlyDefault('apple')).toBe(true)
    expect(localOnlyDefault('cloud')).toBe(false)
    expect(localOnlyDefault('skip')).toBe(false)
  })
})

describe('finishCtaEnabled', () => {
  it('aktiv, wenn alle Zeilen fertig sind', () => {
    expect(finishCtaEnabled(['done', 'done'])).toBe(true)
  })

  it('aktiv im Pausen-Modus — Mail funktioniert auch ohne Eule', () => {
    expect(finishCtaEnabled(['paused', 'paused'])).toBe(true)
  })

  it('gescheiterte Zeilen blockieren den Einstieg nicht', () => {
    expect(finishCtaEnabled(['done', 'failed'])).toBe(true)
  })

  it('blockiert, solange eine Zeile laeuft oder noch ansteht', () => {
    expect(finishCtaEnabled(['done', 'running'])).toBe(false)
    expect(finishCtaEnabled(['idle', 'done'])).toBe(false)
  })

  it('ohne Zeilen trivially aktiv (kommt nach Schritt 2 nicht vor)', () => {
    expect(finishCtaEnabled([])).toBe(true)
  })
})

describe('enterAction', () => {
  interface Ctx {
    connectedCount: number
    aiReady: boolean
    aiTrains: boolean
    aiSkip: boolean
    rowStates: TrainRowState[]
  }
  const ctx = (overrides: Partial<Ctx> = {}): Ctx => ({
    connectedCount: 1,
    aiReady: false,
    aiTrains: false,
    aiSkip: false,
    rowStates: [],
    ...overrides
  })

  it('Schritt 1: Enter geht immer zu connect', () => {
    expect(enterAction(1, ctx({ connectedCount: 0 }))).toEqual({ kind: 'to-connect' })
  })

  it('Schritt 2: ohne Konto Toast, mit Konto weiter zur KI-Wahl', () => {
    expect(enterAction(2, ctx({ connectedCount: 0 }))).toEqual({ kind: 'toast-connect-one' })
    expect(enterAction(2, ctx({ connectedCount: 2 }))).toEqual({ kind: 'to-key' })
  })

  it('Schritt 3: Enter nur bei fertiger Option — mit Entwurfs-KI Training, sonst pausiert', () => {
    expect(enterAction(3, ctx())).toBeNull()
    expect(enterAction(3, ctx({ aiReady: true, aiTrains: true }))).toEqual({ kind: 'to-training' })
    expect(enterAction(3, ctx({ aiReady: true, aiTrains: false }))).toEqual({
      kind: 'to-training-paused'
    })
  })

  it('Schritt 3: Überspringen nie per Enter-Reflex', () => {
    expect(enterAction(3, ctx({ aiReady: true, aiSkip: true }))).toBeNull()
  })

  it('Schritt 4: Enter beendet nur, wenn nichts mehr laeuft', () => {
    expect(enterAction(4, ctx({ rowStates: ['running', 'done'] }))).toBeNull()
    expect(enterAction(4, ctx({ rowStates: ['idle'] }))).toBeNull()
    expect(enterAction(4, ctx({ rowStates: ['done', 'done'] }))).toEqual({ kind: 'finish' })
  })

  it('Schritt 4 pausiert: Enter beendet sofort', () => {
    expect(enterAction(4, ctx({ rowStates: ['paused', 'paused'] }))).toEqual({ kind: 'finish' })
  })

  it('Schritt 4 mit gescheiterten Zeilen: Einstieg bleibt moeglich', () => {
    expect(enterAction(4, ctx({ rowStates: ['failed', 'done'] }))).toEqual({ kind: 'finish' })
  })
})
