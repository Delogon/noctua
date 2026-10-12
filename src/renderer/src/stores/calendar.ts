import { create } from 'zustand'
import { dayKey, parseDayKey, shiftAnchor, type CalView } from '@renderer/features/calendar/dates'
import type { EventForm } from '@renderer/features/calendar/event-form'
import { usePaper } from './paper'

// UI state of the calendar view: view, anchor day, selection and editor. The anchor day
// is a local calendar day ('YYYY-MM-DD'); the view derives week/month from it.

export type EditorTarget =
  | { kind: 'existing'; objectId: number; recurrenceId: string | null }
  | {
      kind: 'new'
      form: EventForm
      rev: number
      /** Runs only after a successful save (not on cancel/close) */
      onSaved?: () => void
    }

/** Quick-create popover: time window plus the slot's screen position. */
export interface QuickDraft {
  startMs: number
  endMs: number
  allDay: boolean
  rect: { left: number; top: number; width: number; height: number }
}

export interface DeleteTarget {
  objectId: number
  recurrenceId: string | null
  recurring: boolean
  summary: string
}

export function instanceKey(objectId: number, recurrenceId: string | null): string {
  return `${objectId}:${recurrenceId ?? ''}`
}

interface CalendarState {
  mode: CalView
  anchor: string
  selKey: string | null
  editor: EditorTarget | null
  quick: QuickDraft | null
  deleteTarget: DeleteTarget | null
  setMode: (mode: CalView) => void
  setAnchor: (key: string) => void
  /** Set the anchor to `day` and switch to the day view (month "+k more", day number) */
  showDay: (key: string) => void
  goToday: () => void
  shift: (dir: number) => void
  select: (key: string | null) => void
  openExisting: (objectId: number, recurrenceId: string | null) => void
  openNew: (form: EventForm, opts?: { onSaved?: () => void }) => void
  /** Cancel/close: the new editor's onSaved lapses */
  closeEditor: () => void
  /** The editor saved successfully: close and fire the new editor's onSaved */
  finishEditor: () => void
  setQuick: (quick: QuickDraft | null) => void
  setDeleteTarget: (target: DeleteTarget | null) => void
  /** Jump to an event (agenda, reminder click): open the view, select the day, open the editor */
  focusEvent: (objectId: number, recurrenceId: string | null, startMs: number) => void
}

export const useCalendar = create<CalendarState>((set, get) => ({
  mode: 'week',
  anchor: dayKey(new Date()),
  selKey: null,
  editor: null,
  quick: null,
  deleteTarget: null,
  setMode: (mode) => set({ mode, quick: null }),
  setAnchor: (anchor) => set({ anchor, quick: null }),
  showDay: (anchor) => set({ anchor, mode: 'day', quick: null }),
  goToday: () => set({ anchor: dayKey(new Date()), quick: null }),
  shift: (dir) =>
    set((s) => ({
      anchor: dayKey(shiftAnchor(s.mode, parseDayKey(s.anchor), dir)),
      quick: null
    })),
  select: (selKey) => set({ selKey }),
  openExisting: (objectId, recurrenceId) =>
    set({
      editor: { kind: 'existing', objectId, recurrenceId },
      selKey: instanceKey(objectId, recurrenceId),
      quick: null
    }),
  openNew: (form, opts) =>
    set({ editor: { kind: 'new', form, rev: Date.now(), onSaved: opts?.onSaved }, quick: null }),
  closeEditor: () => set({ editor: null }),
  finishEditor: () => {
    const editor = get().editor
    set({ editor: null })
    if (editor?.kind === 'new') editor.onSaved?.()
  },
  setQuick: (quick) => set({ quick }),
  setDeleteTarget: (deleteTarget) => set({ deleteTarget }),
  focusEvent: (objectId, recurrenceId, startMs) => {
    usePaper.getState().setView('calendar')
    set({
      anchor: dayKey(new Date(startMs)),
      selKey: instanceKey(objectId, recurrenceId),
      editor: { kind: 'existing', objectId, recurrenceId },
      quick: null
    })
  }
}))
