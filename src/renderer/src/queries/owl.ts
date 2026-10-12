import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import type { InvokeInput, InvokeOutput } from '@shared/ipc-contract'
import type { OwlConversationListItem } from '@shared/types'

// Persisted owl conversations (Owl view). Invalidation runs, as everywhere
// in the codebase, via react-query — the list updates itself after every
// save/delete.

export function useOwlConversations(): UseQueryResult<OwlConversationListItem[]> {
  return useQuery({
    queryKey: ['owl', 'conversations'],
    queryFn: () => invoke('owl:list', undefined),
    select: (data) => data.conversations,
    staleTime: 5_000
  })
}

export function useSaveOwlConversation(): UseMutationResult<
  InvokeOutput<'owl:save'>,
  Error,
  InvokeInput<'owl:save'>
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InvokeInput<'owl:save'>) => invoke('owl:save', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['owl'] })
  })
}

export function useDeleteOwlConversation(): UseMutationResult<
  InvokeOutput<'owl:delete'>,
  Error,
  InvokeInput<'owl:delete'>
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InvokeInput<'owl:delete'>) => invoke('owl:delete', input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['owl'] })
  })
}
