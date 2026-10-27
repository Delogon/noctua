import { beforeEach, describe, expect, it } from 'vitest'
import { usePaper } from '@renderer/stores/paper'

describe('Paper-Store Konto-Filter', () => {
  beforeEach(() => {
    usePaper.setState({ filter: null, selThreadKey: null })
  })

  it.each([
    { label: 'ein bestimmtes Konto', accountId: 23 },
    { label: 'alle Konten', accountId: null }
  ])('löscht die Thread-Auswahl für $label', ({ accountId }) => {
    usePaper.setState({ filter: accountId === null ? 23 : null, selThreadKey: 'thread:alt' })

    usePaper.getState().setFilter(accountId)

    expect(usePaper.getState().filter).toBe(accountId)
    expect(usePaper.getState().selThreadKey).toBeNull()
  })
})

describe('Paper-Store Ordneransicht', () => {
  beforeEach(() => {
    usePaper.setState({ filter: null, mbox: 'inbox', folderId: null, selThreadKey: 'x' })
  })

  it('openFolder setzt Konto, Sicht und Ordner in einem Schritt', () => {
    usePaper.getState().openFolder({ accountId: 4, mbox: 'spam', folderId: 9 })
    const s = usePaper.getState()
    expect([s.filter, s.mbox, s.folderId, s.selThreadKey, s.view]).toEqual([
      4,
      'spam',
      9,
      null,
      'inbox'
    ])
  })

  it('Tabs und Kontofilter verlassen den Einzelordner', () => {
    usePaper.getState().openFolder({ accountId: 4, mbox: 'inbox', folderId: 9 })
    usePaper.getState().setMbox('sent')
    expect(usePaper.getState().folderId).toBeNull()
    usePaper.getState().openFolder({ accountId: 4, mbox: 'inbox', folderId: 9 })
    usePaper.getState().setFilter(null)
    expect(usePaper.getState().folderId).toBeNull()
  })
})
