import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

/**
 * Key status + active models (from ai:usage — both are already there).
 * hasKey = OpenRouter key stored; ready/block = whether the AI can draft.
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

/** Availability of Apple Intelligence (on-device triage). */
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

/** All provider profiles (built-in OpenRouter first). */
export function useProfiles(): UseQueryResult<AiProfile[]> {
  return useQuery({
    queryKey: ['ai', 'profiles'],
    queryFn: () => invoke('ai:profiles:list', undefined),
    select: (d) => d.profiles,
    staleTime: 10_000
  })
}

/** Assignment task → profile + model (incl. blocking reason). */
export function useTaskAssignments(): UseQueryResult<TaskAssignments> {
  return useQuery({
    queryKey: ['ai', 'tasks'],
    queryFn: () => invoke('ai:tasks:get', undefined),
    staleTime: 10_000
  })
}

/** "Local only": global toggle (masthead indicator + settings). */
export function useLocalOnly(): UseQueryResult<boolean> {
  return useQuery({
    queryKey: ['privacy', 'localOnly'],
    queryFn: () => invoke('privacy:getLocalOnly', undefined),
    select: (d) => d.localOnly,
    staleTime: 30_000
  })
}

/**
 * Model list of a profile (OpenRouter: live catalog, otherwise GET /models).
 * With Local only, main returns `skipped` for external profiles — the UI
 * then offers an explicit "Load list" button (manual).
 */
export function useProfileModels(profileId: string | null): UseQueryResult<ProfileModels> {
  return useQuery({
    queryKey: ['ai', 'profileModels', profileId],
    queryFn: () =>
      invoke('ai:profileModels', { profileId: profileId!, manual: false, kind: 'chat' }),
    enabled: profileId !== null,
    staleTime: 60 * 60 * 1000,
    retry: 1
  })
}

/** Decision models (capability `decision`) of a profile – separate from the chat list. */
export function useDecisionModels(profileId: string | null): UseQueryResult<ProfileModels> {
  return useQuery({
    queryKey: ['ai', 'profileModels', profileId, 'decision'],
    queryFn: () =>
      invoke('ai:profileModels', { profileId: profileId!, manual: false, kind: 'decision' }),
    enabled: profileId !== null,
    staleTime: 30_000,
    retry: 1
  })
}

/** Spam/phishing assessment of a mail (local rules + decision model if any). */
export function useMailSecurity(messageId: number): UseQueryResult<InvokeOutput<'security:get'>> {
  return useQuery({
    queryKey: ['security', messageId],
    queryFn: () => invoke('security:get', { messageId }),
    staleTime: 60_000
  })
}

/** Status of the local search model (embeddings). */
export function useEmbeddingStatus(): UseQueryResult<InvokeOutput<'embeddings:status'>> {
  return useQuery({
    queryKey: ['ai', 'embeddings'],
    queryFn: () => invoke('embeddings:status', undefined),
    staleTime: 5_000
  })
}

/** Branding/onboarding hints of the org configuration (upstream: defaults). */
export function useOrgInfo(): UseQueryResult<InvokeOutput<'org:info'>> {
  return useQuery({
    queryKey: ['org', 'info'],
    queryFn: () => invoke('org:info', undefined),
    staleTime: Infinity
  })
}
