import { describe, expect, it } from 'vitest'
import { folderLeaf, inferSpecialUses, roleFromName } from '@shared/folder-roles'

describe('roleFromName', () => {
  it.each([
    ['Junk', '/', 'junk'],
    ['Spam', '.', 'junk'],
    ['INBOX.Spam', '.', 'junk'],
    ['[Gmail]/Spam', '/', 'junk'],
    ['Junk-E-Mail', '/', 'junk'],
    ['Junk E-mail', '/', 'junk'],
    ['Gelöschte Elemente', '/', 'trash'],
    ['Sent Items', '/', 'sent'],
    ['Entwürfe', '/', 'drafts'],
    ['Archiv', '/', 'archive'],
    ['Projects', '/', 'other'],
    // Tief verschachtelt oder unter eigenem Ordner: kein Systemordner
    ['Clients/Spam', '/', 'other'],
    ['INBOX.Kunden.Spam', '.', 'other']
  ])('%s → %s', (path, delimiter, role) => {
    expect(roleFromName(path, delimiter)).toBe(role)
  })
})

describe('inferSpecialUses', () => {
  it('Server-Flags gewinnen, INBOX ist immer \\Inbox', () => {
    expect(
      inferSpecialUses([
        { path: 'INBOX', delimiter: '/' },
        { path: 'Gesendet', delimiter: '/', specialUse: '\\Sent' }
      ])
    ).toEqual(['\\Inbox', '\\Sent'])
  })

  it('erkennt Spam-Ordner ohne SPECIAL-USE — auch neben einem geflaggten Junk', () => {
    expect(
      inferSpecialUses([
        { path: 'Junk', delimiter: '/', specialUse: '\\Junk' },
        { path: 'Spam', delimiter: '/' }
      ])
    ).toEqual(['\\Junk', '\\Junk'])
  })

  it('vergibt andere Rollen nur, wenn der Server sie nicht meldet', () => {
    expect(
      inferSpecialUses([
        { path: 'Sent Items', delimiter: '/', specialUse: '\\Sent' },
        { path: 'Sent', delimiter: '/' },
        { path: 'Archive', delimiter: '/' },
        { path: 'Archiv', delimiter: '/' }
      ])
    ).toEqual(['\\Sent', null, '\\Archive', null])
  })
})

describe('folderLeaf', () => {
  it('liefert den letzten Pfadteil', () => {
    expect(folderLeaf('INBOX.Projekte.Q4', '.')).toBe('Q4')
    expect(folderLeaf('Projekte', null)).toBe('Projekte')
  })
})
