import { create } from 'zustand'
import { dayKey, parseDayKey, shiftAnchor, type CalView } from '@renderer/features/calendar/dates'
import type { EventForm } from '@renderer/features/calendar/event-form'
import { usePaper } from './paper'

// UI-Zustand der Kalenderansicht: Ansicht, Ankertag, Auswahl und Editor. Der Ankertag
// ist ein lokaler Kalendertag ('YYYY-MM-DD'); die Ansicht leitet daraus Woche/Monat ab.

export type EditorTarget =
  | { kind: 'existing'; objectId: number; recurrenceId: string | null }
  | {
      kind: 'new'
      form: EventForm
      rev: number
      /** Läuft erst nach erfolgreichem Speichern (nicht bei Abbrechen/Schließen) */
      onSaved?: () => void
    }

/** Schnell-Anlegen-Popover: Zeitfenster plus Bildschirmposition des Slots. */
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
  /** Anker auf `day` setzen und in die Tagesansicht wechseln (Monats-„+k mehr", Tageszahl) */
  showDay: (key: string) => void
  goToday: () => void
  shift: (dir: number) => void
  select: (key: string | null) => void
  openExisting: (objectId: number, recurrenceId: string | null) => void
  openNew: (form: EventForm, opts?: { onSaved?: () => void }) => void
  /** Abbrechen/Schließen: onSaved des Neu-Editors verfällt */
  closeEditor: () => void
  /** Der Editor hat erfolgreich gespeichert: schließen und onSaved des Neu-Editors auslösen */
  finishEditor: () => void
  setQuick: (quick: QuickDraft | null) => void
  setDeleteTarget: (target: DeleteTarget | null) => void
  /** Zu einem Termin springen (Agenda, Erinnerungs-Klick): Ansicht öffnen, Tag wählen, Editor auf */
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
