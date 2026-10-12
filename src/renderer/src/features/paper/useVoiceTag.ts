import { useQuery } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { parseVoiceMeta, type VoiceMeta } from '@renderer/features/paper/account-states'

interface Profile {
  languages?: string[]
  formality?: string
  style_notes?: string[]
  greetings?: string[]
  closings?: string[]
}

export function useStyleProfile(accountId: number | null): Profile | null {
  const q = useQuery({
    queryKey: ['styleProfile', accountId],
    queryFn: async () => {
      const scoped = accountId
        ? await invoke('settings:get', { key: `ai.styleProfile.${accountId}` })
        : { value: null }
      const raw = scoped.value ?? (await invoke('settings:get', { key: 'ai.styleProfile' })).value
      if (!raw) return null
      try {
        return JSON.parse(raw) as Profile
      } catch {
        return null
      }
    },
    staleTime: 60_000
  })
  return q.data ?? null
}

/**
 * Freshness metadata of the voice card (Design 3e): how many replies the owl
 * knows and when it last learned. Account meta preferred, global as a
 * fallback (legacy data from training runs without accountId).
 */
export function useStyleMeta(accountId: number): VoiceMeta | null {
  const q = useQuery({
    queryKey: ['styleMeta', accountId],
    queryFn: async () => {
      const scoped = await invoke('settings:get', { key: `ai.styleMeta.${accountId}` })
      const raw = scoped.value ?? (await invoke('settings:get', { key: 'ai.styleMeta' })).value
      return parseVoiceMeta(raw)
    },
    staleTime: 60_000
  })
  return q.data ?? null
}

/** Short voice tag for the composer/rail label: „Europa — warm · knapp · DE" */
export function useVoiceTag(accountId: number | null, accountName: string | null): string {
  const profile = useStyleProfile(accountId)
  const name = accountName ?? '—'
  if (!profile) return name
  const bits = [
    ...(profile.style_notes ?? []).slice(0, 2),
    (profile.languages ?? []).slice(0, 2).join('/')
  ].filter(Boolean)
  return bits.length > 0 ? `${name} — ${bits.join(' · ')}` : name
}
