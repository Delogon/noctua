import { useEffect } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import type { InvokeInput, InvokeOutput } from '@shared/ipc-contract'

export function useAccounts(): UseQueryResult<InvokeOutput<'accounts:list'>['accounts']> {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('sync:state', () => {
        void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      }),
    [queryClient]
  )
  return useQuery({
    queryKey: ['accounts'],
    queryFn: () => invoke('accounts:list', undefined),
    select: (data) => data.accounts
  })
}

export function useAddAccount(): UseMutationResult<
  InvokeOutput<'accounts:add'>,
  Error,
  InvokeInput<'accounts:add'>
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InvokeInput<'accounts:add'>) => invoke('accounts:add', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
    }
  })
}

export function useAddMicrosoft(): UseMutationResult<
  InvokeOutput<'accounts:addMicrosoft'>,
  Error,
  InvokeInput<'accounts:addMicrosoft'>
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InvokeInput<'accounts:addMicrosoft'>) =>
      invoke('accounts:addMicrosoft', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
    }
  })
}

export function useAddGoogle(): UseMutationResult<
  InvokeOutput<'accounts:addGoogle'>,
  Error,
  InvokeInput<'accounts:addGoogle'>
> {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: InvokeInput<'accounts:addGoogle'>) => invoke('accounts:addGoogle', input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['threads'] })
    }
  })
}
