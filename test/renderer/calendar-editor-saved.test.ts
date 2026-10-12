import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCalendar } from '@renderer/stores/calendar'
import { formFromSlot } from '@renderer/features/calendar/event-form'

// Terminvorschlag „Bearbeiten…": der Vorschlag gilt erst als erledigt, wenn der Editor
// erfolgreich gespeichert hat (finishEditor → onSaved); Abbrechen lässt ihn „neu".

const form = formFromSlot(
  new Date(2026, 9, 5, 9).getTime(),
  new Date(2026, 9, 5, 10).getTime(),
  false,
  1
)

beforeEach(() => {
  useCalendar.setState({ editor: null })
})

describe('openNew onSaved', () => {
  it('Speichern (finishEditor) schließt und ruft onSaved genau einmal', () => {
    const onSaved = vi.fn()
    useCalendar.getState().openNew(form, { onSaved })
    expect(useCalendar.getState().editor?.kind).toBe('new')
    expect(onSaved).not.toHaveBeenCalled()
    useCalendar.getState().finishEditor()
    expect(onSaved).toHaveBeenCalledTimes(1)
    expect(useCalendar.getState().editor).toBeNull()
    useCalendar.getState().finishEditor()
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('Abbrechen/Schließen ruft onSaved nie', () => {
    const onSaved = vi.fn()
    useCalendar.getState().openNew(form, { onSaved })
    useCalendar.getState().closeEditor()
    expect(onSaved).not.toHaveBeenCalled()
    expect(useCalendar.getState().editor).toBeNull()
  })

  it('ein anderer Neu-Editor ersetzt den ersten: dessen onSaved verfällt', () => {
    const first = vi.fn()
    const second = vi.fn()
    useCalendar.getState().openNew(form, { onSaved: first })
    useCalendar.getState().openNew(form, { onSaved: second })
    useCalendar.getState().finishEditor()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('Neu-Editor ohne Callback und bestehender Termin: finishEditor schließt nur', () => {
    useCalendar.getState().openNew(form)
    expect(() => useCalendar.getState().finishEditor()).not.toThrow()
    useCalendar.getState().openExisting(7, null)
    useCalendar.getState().finishEditor()
    expect(useCalendar.getState().editor).toBeNull()
  })
})
