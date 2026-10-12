import { describe, expect, it } from 'vitest'
import {
  reconcilePaletteSelection,
  routePaletteQuery,
  visibleMailboxForSearchHit
} from '../../src/renderer/src/features/search/palette-router'

// Since mail search lives in the Owl view, the router only filters
// commands: no mode routing, no search section. `>` stays as a deliberate
// commands-only mode.

const commands = [
  { id: 'compose', label: 'Neue E-Mail' },
  { id: 'inbox', label: 'Zum Posteingang' },
  { id: 'sent', label: 'Ordner: Gesendet' },
  { id: 'settings', label: 'Einstellungen öffnen', note: 'Konten und Modelle' }
]

describe('routePaletteQuery', () => {
  it('shows every command while the query is empty', () => {
    expect(routePaletteQuery('   ', commands)).toEqual({
      commandQuery: '',
      commandIds: ['compose', 'inbox', 'sent', 'settings'],
      forcedCommands: false
    })
  })

  it('keeps an exact multiword command match first', () => {
    const route = routePaletteQuery('Neue E-Mail', commands)

    expect(route.commandIds[0]).toBe('compose')
    expect(route.forcedCommands).toBe(false)
  })

  it('returns no commands for a free-form question (the owl view owns search)', () => {
    const route = routePaletteQuery(
      'Wann hat mir die Stadt Oldenburg wegen der Plakatiererlaubnis geschrieben?',
      commands
    )

    expect(route.commandIds).toEqual([])
  })

  it('filters to a short partial command', () => {
    expect(routePaletteQuery('Gesendet', commands).commandIds).toEqual(['sent'])
  })

  it('keeps the leading angle bracket as deliberate command-only mode', () => {
    const route = routePaletteQuery('> einstellungen', commands)

    expect(route.forcedCommands).toBe(true)
    expect(route.commandQuery).toBe('einstellungen')
    expect(route.commandIds).toEqual(['settings'])
  })

  it('matches commands independent of accents and punctuation', () => {
    expect(routePaletteQuery('einstellungen offnen', commands).commandIds).toEqual(['settings'])
  })
})

describe('visibleMailboxForSearchHit', () => {
  it('switches only to mailboxes represented by the visible folder tabs', () => {
    expect(visibleMailboxForSearchHit('inbox')).toBe('inbox')
    expect(visibleMailboxForSearchHit('sent')).toBe('sent')
    expect(visibleMailboxForSearchHit('archive')).toBeNull()
    expect(visibleMailboxForSearchHit('other')).toBeNull()
  })
})

describe('reconcilePaletteSelection', () => {
  it('moves an automatic selection to the newly prioritized entry', () => {
    expect(
      reconcilePaletteSelection({ id: 'command:settings', manual: false }, [
        'hit:91',
        'command:settings'
      ])
    ).toEqual({ id: 'hit:91', manual: false })
  })

  it('keeps a manually chosen entry when new results arrive', () => {
    expect(
      reconcilePaletteSelection({ id: 'command:settings', manual: true }, [
        'hit:91',
        'command:settings'
      ])
    ).toEqual({ id: 'command:settings', manual: true })
  })

  it('falls back safely when a selected result disappears', () => {
    expect(reconcilePaletteSelection({ id: 'hit:12', manual: true }, ['hit:91', 'hit:92'])).toEqual(
      { id: 'hit:91', manual: false }
    )
  })
})
