import { useEffect } from 'react'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

// CardDAV-Kontakte eines Kalender-Kontos (Phase 3.1): Status + Adressbücher.

export function useDavContacts(
  accountId: number
): UseQueryResult<InvokeOutput<'contacts:dav:status'>> {
  const queryClient = useQueryClient()
  useEffect(
    () =>
      onPush('contacts:changed', () => {
        void queryClient.invalidateQueries({ queryKey: ['contacts', 'dav'] })
      }),
    [queryClient]
  )
  return useQuery({
    queryKey: ['contacts', 'dav', accountId],
    queryFn: () => invoke('contacts:dav:status', { accountId })
  })
}
