import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

/**
 * Key-Status + aktive Modelle (aus ai:usage — dort liegt beides schon).
 * hasKey = OpenRouter-Schlüssel hinterlegt; ready/block = kann die AI entwerfen.
 */
export function useOrKeyStatus(): UseQueryResult<{
  hasKey: boolean
  ready: boolean
  block: InvokeOutput<'ai:usage'>['draftBlock']
}> {
  return useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => invoke('ai:usage', undefined),
    select: (d) => ({ hasKey: d.openrouterKey, ready: d.hasApiKey, block: d.draftBlock }),
    staleTime: 10_000
  })
}

export function useModels(): UseQueryResult<{ scanModel: string; writeModel: string }> {
  return useQuery({
    queryKey: ['ai', 'usage'],
    queryFn: () => invoke('ai:usage', undefined),
    select: (d) => ({ scanModel: d.triageModel, writeModel: d.draftModel }),
    staleTime: 10_000
  })
}

/** Verfügbarkeit von Apple Intelligence (On-Device-Triage). */
export function useAppleFm(): UseQueryResult<InvokeOutput<'ai:appleFm'>> {
  return useQuery({
    queryKey: ['ai', 'appleFm'],
    queryFn: () => invoke('ai:appleFm', undefined),
    staleTime: 30_000,
    retry: false
  })
}

export type AiProfile = InvokeOutput<'ai:profiles:list'>['profiles'][number]
export type TaskAssignments = InvokeOutput<'ai:tasks:get'>
export type AiTaskName = keyof TaskAssignments
export type ProfileModels = InvokeOutput<'ai:profileModels'>

/** Alle Provider-Profile (eingebautes OpenRouter zuerst). */
export function useProfiles(): UseQueryResult<AiProfile[]> {
  return useQuery({
    queryKey: ['ai', 'profiles'],
    queryFn: () => invoke('ai:profiles:list', undefined),
    select: (d) => d.profiles,
    staleTime: 10_000
  })
}

/** Zuordnung Aufgabe → Profil + Modell (inkl. Blockiergrund). */
export function useTaskAssignments(): UseQueryResult<TaskAssignments> {
  return useQuery({
    queryKey: ['ai', 'tasks'],
    queryFn: () => invoke('ai:tasks:get', undefined),
    staleTime: 10_000
  })
}

/** „Local only": globaler Schalter (Masthead-Anzeige + Einstellungen). */
export function useLocalOnly(): UseQueryResult<boolean> {
  return useQuery({
    queryKey: ['privacy', 'localOnly'],
    queryFn: () => invoke('privacy:getLocalOnly', undefined),
    select: (d) => d.localOnly,
    staleTime: 30_000
  })
}

/**
 * Modellliste eines Profils (OpenRouter: Live-Katalog, sonst GET /models).
 * Bei Local only liefert Main für externe Profile `skipped` — die Oberfläche
 * bietet dann einen ausdrücklichen „Liste laden"-Knopf (manual) an.
 */
export function useProfileModels(profileId: string | null): UseQueryResult<ProfileModels> {
  return useQuery({
    queryKey: ['ai', 'profileModels', profileId],
    queryFn: () => invoke('ai:profileModels', { profileId: profileId!, manual: false }),
    enabled: profileId !== null,
    staleTime: 60 * 60 * 1000,
    retry: 1
  })
}

/** Status des lokalen Suchmodells (Embeddings). */
export function useEmbeddingStatus(): UseQueryResult<InvokeOutput<'embeddings:status'>> {
  return useQuery({
    queryKey: ['ai', 'embeddings'],
    queryFn: () => invoke('embeddings:status', undefined),
    staleTime: 5_000
  })
}

/** Branding-/Onboarding-Hinweise der Org-Konfiguration (Upstream: Standardwerte). */
export function useOrgInfo(): UseQueryResult<InvokeOutput<'org:info'>> {
  return useQuery({
    queryKey: ['org', 'info'],
    queryFn: () => invoke('org:info', undefined),
    staleTime: Infinity
  })
}
