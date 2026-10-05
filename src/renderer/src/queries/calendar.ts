import { useEffect } from 'react'
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseQueryResult
} from '@tanstack/react-query'
import { invoke, onPush } from '@renderer/lib/ipc'
import { useCalendar } from '@renderer/stores/calendar'
import type { InvokeInput, InvokeOutput } from '@shared/ipc-contract'
import type { CalendarEventInput } from '@shared/calendar-types'

// Kalender-Konten und -Listen (Phase 2.1) sowie die Kalenderansicht (2.2). Schlüssel:
// ['calendar', 'accounts'|'list'|'events'|'event'].

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

// --- Ansicht (Phase 2.2) -------------------------------------------------------------------

type CalendarList = InvokeOutput<'calendar:list'>['calendars']
export type CalendarInstances = InvokeOutput<'calendar:events:list'>['events']
const EMPTY_EVENTS: CalendarInstances = []
/** Nachbarperioden gelten kurz als frisch, damit Blättern nicht neu lädt. */
const PREFETCH_STALE_MS = 30_000

function eventsQuery(
  rangeStart: number,
  rangeEnd: number,
  calendarIds: readonly number[]
): {
  queryKey: readonly unknown[]
  queryFn: () => Promise<InvokeOutput<'calendar:events:list'>>
} {
  return {
    queryKey: ['calendar', 'events', rangeStart, rangeEnd, calendarIds.join(',')],
    queryFn: () =>
      invoke('calendar:events:list', { rangeStart, rangeEnd, calendarIds: [...calendarIds] })
  }
}

/** Termine im Zeitraum [rangeStart, rangeEnd) der angegebenen Kalender. */
export function useCalendarEvents(
  rangeStart: number,
  rangeEnd: number,
  calendarIds: readonly number[]
): { events: CalendarInstances; isLoading: boolean; isError: boolean } {
  const q = useQuery({
    ...eventsQuery(rangeStart, rangeEnd, calendarIds),
    enabled: calendarIds.length > 0,
    placeholderData: keepPreviousData,
    select: (data) => data.events
  })
  return {
    events: calendarIds.length > 0 ? (q.data ?? EMPTY_EVENTS) : EMPTY_EVENTS,
    isLoading: q.isLoading,
    isError: q.isError
  }
}

/** Nachbarperioden vorab laden (flüssiges Blättern). */
export function usePrefetchEvents(
  ranges: ReadonlyArray<{ start: number; end: number }>,
  calendarIds: readonly number[]
): void {
  const queryClient = useQueryClient()
  const rangesKey = ranges.map((r) => `${r.start}-${r.end}`).join('|')
  const idsKey = calendarIds.join(',')
  useEffect(() => {
    const ids = idsKey ? idsKey.split(',').map(Number) : []
    if (ids.length === 0) return
    for (const r of rangesKey.split('|')) {
      const [start, end] = r.split('-').map(Number)
      void queryClient.prefetchQuery({
        ...eventsQuery(start, end, ids),
        staleTime: PREFETCH_STALE_MS
      })
    }
  }, [queryClient, rangesKey, idsKey])
}

/** Einzelnes Ereignis bzw. Vorkommen mit allen editierbaren Feldern. */
export function useCalendarEventDetail(
  objectId: number | null,
  recurrenceId: string | null
): UseQueryResult<InvokeOutput<'calendar:events:get'>['event']> {
  return useQuery({
    queryKey: ['calendar', 'event', objectId, recurrenceId],
    queryFn: () => invoke('calendar:events:get', { objectId: objectId ?? 0, recurrenceId }),
    enabled: objectId !== null,
    select: (data) => data.event,
    staleTime: 0,
    gcTime: 0
  })
}

/** Alle Kalender-Abfragen (außer Konten) neu laden. */
export function invalidateCalendarData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] })
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'event'] })
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'list'] })
}

/** Sichtbarkeit/Farbe mit sofortiger Anzeige (optimistisch), danach Abgleich. */
export function useCalendarListActions(): {
  setVisible: (calendarId: number, visible: boolean) => Promise<void>
  setColor: (calendarId: number, color: string | null) => Promise<void>
} {
  const queryClient = useQueryClient()
  const patch = (calendarId: number, change: Partial<CalendarList[number]>): void => {
    queryClient.setQueryData<InvokeOutput<'calendar:list'>>(['calendar', 'list'], (old) =>
      old
        ? { calendars: old.calendars.map((c) => (c.id === calendarId ? { ...c, ...change } : c)) }
        : old
    )
  }
  return {
    setVisible: async (calendarId, visible) => {
      patch(calendarId, { visible })
      try {
        await invoke('calendar:setVisible', { calendarId, visible })
      } finally {
        invalidateCalendarData(queryClient)
      }
    },
    setColor: async (calendarId, color) => {
      patch(calendarId, { color })
      try {
        await invoke('calendar:setColor', { calendarId, color })
      } finally {
        invalidateCalendarData(queryClient)
      }
    }
  }
}

/** Termine anlegen/ändern/löschen; die Listen laden danach neu. */
export function useCalendarEventActions(): {
  create: (event: CalendarEventInput) => Promise<void>
  update: (input: InvokeInput<'calendar:events:update'>) => Promise<void>
  remove: (input: InvokeInput<'calendar:events:delete'>) => Promise<void>
} {
  const queryClient = useQueryClient()
  return {
    create: async (event) => {
      await invoke('calendar:events:create', { event })
      invalidateCalendarData(queryClient)
    },
    update: async (input) => {
      await invoke('calendar:events:update', input)
      invalidateCalendarData(queryClient)
    },
    remove: async (input) => {
      await invoke('calendar:events:delete', input)
      invalidateCalendarData(queryClient)
    }
  }
}

/**
 * Globale Live-Updates (einmal in App): Änderungen aus dem Sync laden die Ansicht
 * neu; ein Klick auf eine Erinnerung springt zum Termin.
 */
export function useCalendarLive(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const offChanged = onPush('calendar:changed', () => invalidateCalendarData(queryClient))
    const offOpen = onPush('calendar:openEvent', ({ objectId, recurrenceId }) => {
      void invoke('calendar:events:get', { objectId, recurrenceId })
        .then(({ event }) =>
          useCalendar.getState().focusEvent(objectId, recurrenceId, event.startUtc)
        )
        .catch(() => {
          // Termin inzwischen gelöscht — kein Sprung
        })
    })
    return () => {
      offChanged()
      offOpen()
    }
  }, [queryClient])
}
