import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'
import type { AiCategory } from '@shared/types'

/** Invalidiert Thread-Listen und offene Threads bei Push-Events vom Sync/AI. */
export function useThreadInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('messages:changed', ({ threadKeys }) => {
        void queryClient.invalidateQueries({ queryKey: ['threads'] })
        void queryClient.invalidateQueries({ queryKey: ['mboxCounts'] })
        for (const key of threadKeys) {
          void queryClient.invalidateQueries({ queryKey: ['thread', key] })
        }
      }),
    [queryClient]
  )
  useEffect(
    () =>
      onPush('ai:annotated', () => {
        void queryClient.invalidateQueries({ queryKey: ['threads'] })
        void queryClient.invalidateQueries({ queryKey: ['ai', 'usage'] })
        void queryClient.invalidateQueries({ queryKey: ['ai', 'decisions'] })
      }),
    [queryClient]
  )
}

export function useThreads(
  accountId: number | null,
  mbox: 'inbox' | 'sent' | 'spam'
): UseQueryResult<InvokeOutput<'threads:list'>['threads']> {
  return useQuery({
    queryKey: ['threads', accountId, mbox],
    queryFn: () => invoke('threads:list', { limit: 300, accountId: accountId ?? undefined, mbox }),
    select: (data) => data.threads,
    staleTime: 5_000
  })
}

export function useOverrideCategory(): UseMutationResult<
  InvokeOutput<'ai:overrideCategory'>,
  Error,
  { threadKey: string; category: AiCategory | null }
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { threadKey: string; category: AiCategory | null }) =>
      invoke('ai:overrideCategory', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['threads'] })
  })
}

export function useThread(
  threadKey: string | null
): UseQueryResult<InvokeOutput<'threads:get'>['messages']> {
  return useQuery({
    queryKey: ['thread', threadKey],
    queryFn: () => invoke('threads:get', { threadKey: threadKey! }),
    select: (data) => data.messages,
    enabled: threadKey !== null
  })
}

export function useMboxCounts(
  accountId: number | null
): UseQueryResult<InvokeOutput<'threads:mboxCounts'>> {
  return useQuery({
    queryKey: ['mboxCounts', accountId],
    queryFn: () => invoke('threads:mboxCounts', { accountId: accountId ?? undefined }),
    staleTime: 10_000
  })
}
