import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

export function useTaskInvalidation(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    }
    // Jede Task-Mutation pusht tasks:changed aus dem Main-Prozess — so ist der
    // Toggle überall sofort sichtbar, egal von welcher Stelle der invoke kommt.
    const offAnnotated = onPush('ai:annotated', invalidate)
    const offChanged = onPush('tasks:changed', invalidate)
    return () => {
      offAnnotated()
      offChanged()
    }
  }, [queryClient])
}

export function useTasks(status: 'open' | 'done'): UseQueryResult<InvokeOutput<'tasks:list'>> {
  return useQuery({
    queryKey: ['tasks', status],
    queryFn: () => invoke('tasks:list', { status }),
    staleTime: 5_000
  })
}

/** Gewählte CalDAV-Aufgabenliste + wählbare Listen (Phase 3.2). */
export function useTasksSyncSettings(): UseQueryResult<InvokeOutput<'tasks:sync:get'>> {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('calendar:changed', () => {
        void queryClient.invalidateQueries({ queryKey: ['tasks', 'sync'] })
      }),
    [queryClient]
  )
  return useQuery({
    queryKey: ['tasks', 'sync'],
    queryFn: () => invoke('tasks:sync:get', undefined),
    staleTime: 5_000
  })
}
