import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

// Kalender-Konten und -Listen (Phase 2.1). Die Kalenderansicht (2.2) baut auf
// denselben Schlüsseln auf: ['calendar', 'accounts'|'list'|'events'].

export function useCalendarAccounts(): UseQueryResult<
  InvokeOutput<'calendar:accounts:list'>['accounts']
> {
  const queryClient = useQueryClient()
  useEffect(() => {
    const invalidate = (): void => {
      void queryClient.invalidateQueries({ queryKey: ['calendar', 'accounts'] })
    }
    const offState = onPush('calendar:accountState', invalidate)
    const offChanged = onPush('calendar:changed', invalidate)
    return () => {
      offState()
      offChanged()
    }
  }, [queryClient])
  return useQuery({
    queryKey: ['calendar', 'accounts'],
    queryFn: () => invoke('calendar:accounts:list', undefined),
    select: (data) => data.accounts
  })
}

export function useCalendars(): UseQueryResult<InvokeOutput<'calendar:list'>['calendars']> {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('calendar:changed', () => {
        void queryClient.invalidateQueries({ queryKey: ['calendar', 'list'] })
        void queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] })
      }),
    [queryClient]
  )
  return useQuery({
    queryKey: ['calendar', 'list'],
    queryFn: () => invoke('calendar:list', {}),
    select: (data) => data.calendars
  })
}
