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

// Calendar accounts and lists (Phase 2.1) plus the calendar view (2.2). Keys:
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

// --- View (Phase 2.2) ----------------------------------------------------------------------

type CalendarList = InvokeOutput<'calendar:list'>['calendars']
export type CalendarInstances = InvokeOutput<'calendar:events:list'>['events']
const EMPTY_EVENTS: CalendarInstances = []
/** Neighboring periods count as fresh briefly so paging does not reload. */
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

/** Events in the range [rangeStart, rangeEnd) of the given calendars. */
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

/** Prefetch neighboring periods (smooth paging). */
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

/** Single event or occurrence with all editable fields. */
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

/** Scheduling context (organizer?, own addresses, invitation) for editor and delete dialog. */
export function useSchedulingInfo(
  calendarId: number | null,
  objectId: number | null
): UseQueryResult<InvokeOutput<'calendar:scheduling:info'>> {
  return useQuery({
    queryKey: ['calendar', 'scheduling', calendarId, objectId],
    queryFn: () =>
      invoke('calendar:scheduling:info', {
        calendarId: calendarId ?? 0,
        objectId: objectId ?? undefined
      }),
    enabled: calendarId !== null,
    staleTime: 30_000
  })
}

/** Reload all calendar queries (except accounts). */
export function invalidateCalendarData(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'events'] })
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'event'] })
  void queryClient.invalidateQueries({ queryKey: ['calendar', 'list'] })
}

/** Visibility/color with immediate display (optimistic), then reconciliation. */
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

/** Create/change/delete events; the lists reload afterwards. */
export function useCalendarEventActions(): {
  create: (event: CalendarEventInput, opts?: { notifyAttendees?: boolean }) => Promise<void>
  update: (input: InvokeInput<'calendar:events:update'>) => Promise<void>
  remove: (input: InvokeInput<'calendar:events:delete'>) => Promise<void>
} {
  const queryClient = useQueryClient()
  return {
    create: async (event, opts) => {
      await invoke('calendar:events:create', { event, notifyAttendees: opts?.notifyAttendees })
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
 * Global live updates (once in App): changes from sync reload the view;
 * a click on a reminder jumps to the event.
 */
export function useCalendarLive(): void {
  const queryClient = useQueryClient()
  useEffect(() => {
    const offChanged = onPush('calendar:changed', () => invalidateCalendarData(queryClient))
    const open = (objectId: number, recurrenceId: string | null): void => {
      void invoke('calendar:events:get', { objectId, recurrenceId })
        .then(({ event }) =>
          useCalendar.getState().focusEvent(objectId, recurrenceId, event.startUtc)
        )
        .catch(() => {
          // Event deleted in the meantime — no jump
        })
    }
    const offOpen = onPush('calendar:openEvent', ({ objectId, recurrenceId }) =>
      open(objectId, recurrenceId)
    )
    // Invitation card in the mail view ("Open in calendar") fires a window event
    const onWindowOpen = (e: Event): void => {
      const detail = (e as CustomEvent<{ objectId: number; recurrenceId: string | null }>).detail
      if (detail && typeof detail.objectId === 'number') {
        open(detail.objectId, detail.recurrenceId ?? null)
      }
    }
    window.addEventListener('calendar:openEvent', onWindowOpen)
    return () => {
      offChanged()
      offOpen()
      window.removeEventListener('calendar:openEvent', onWindowOpen)
    }
  }, [queryClient])
}
