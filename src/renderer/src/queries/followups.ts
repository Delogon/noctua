import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

export function useFollowupInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('followups:changed', () => {
        void queryClient.invalidateQueries({ queryKey: ['followups'] })
      }),
    [queryClient]
  )
}

export function useFollowups(): UseQueryResult<InvokeOutput<'followups:list'>['items']> {
  return useQuery({
    queryKey: ['followups'],
    queryFn: () => invoke('followups:list', undefined),
    select: (data) => data.items,
    staleTime: 30_000
  })
}
