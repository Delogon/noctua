import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import type { InvokeOutput } from '@shared/ipc-contract'

export function useAppVersion(): UseQueryResult<InvokeOutput<'app:version'>> {
  return useQuery({
    queryKey: ['app', 'version'],
    queryFn: () => invoke('app:version', undefined),
    staleTime: Infinity
  })
}
