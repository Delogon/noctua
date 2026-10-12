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

/** Invalidates thread lists and open threads on push events from sync/AI. */
export function useThreadInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('messages:changed', ({ threadKeys }) => {
        void queryClient.invalidateQueries({ queryKey: ['threads'] })
        void queryClient.invalidateQueries({ queryKey: ['mboxCounts'] })
        void queryClient.invalidateQueries({ queryKey: ['folders'] })
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
  mbox: 'inbox' | 'sent' | 'spam',
  folderId: number | null = null
): UseQueryResult<InvokeOutput<'threads:list'>['threads']> {
  return useQuery({
    queryKey: ['threads', accountId, mbox, folderId],
    queryFn: () =>
      invoke('threads:list', {
        limit: 300,
        accountId: accountId ?? undefined,
        mbox,
        folderId: folderId ?? undefined
      }),
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

/** Folder tree of all accounts (fully synced folders only). */
export function useFolders(
  enabled = true
): UseQueryResult<InvokeOutput<'folders:list'>['folders']> {
  return useQuery({
    queryKey: ['folders'],
    queryFn: () => invoke('folders:list', undefined),
    select: (data) => data.folders,
    staleTime: 10_000,
    enabled
  })
}
