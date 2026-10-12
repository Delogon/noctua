import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

/** Saved reply drafts (one draft per thread), newest first. */
export function useDrafts(): UseQueryResult<InvokeOutput<'drafts:list'>['drafts']> {
  return useQuery({
    queryKey: ['drafts'],
    queryFn: () => invoke('drafts:list', undefined),
    select: (data) => data.drafts,
    staleTime: 10_000
  })
}
