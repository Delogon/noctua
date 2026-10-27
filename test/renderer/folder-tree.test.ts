import { describe, expect, it } from 'vitest'
import type { FolderListItem } from '@shared/types'
import { folderTreeEntries } from '@renderer/features/paper/folder-tree'

let seq = 0
function folder(path: string, role: FolderListItem['role'], delimiter = '/'): FolderListItem {
  seq += 1
  return {
    id: seq,
    accountId: 1,
    path,
    name: path.split(delimiter).pop() ?? path,
    delimiter,
    role,
    threadCount: 0,
    unreadCount: 0
  }
}

describe('folderTreeEntries', () => {
  it('ordnet wie Outlook: Posteingang + Unterordner, Gesendet, Archiv, eigene, Spam zuletzt', () => {
    const entries = folderTreeEntries([
      folder('Junk', 'junk'),
      folder('Projekte/Q4', 'other'),
      folder('Sent', 'sent'),
      folder('INBOX/Kunden', 'other'),
      folder('Archive', 'archive'),
      folder('Projekte', 'other'),
      folder('INBOX', 'inbox')
    ])
    expect(entries.map((e) => [e.folder.path, e.depth])).toEqual([
      ['INBOX', 0],
      ['INBOX/Kunden', 1],
      ['Sent', 0],
      ['Archive', 0],
      ['Projekte', 0],
      ['Projekte/Q4', 1],
      ['Junk', 0]
    ])
  })
})
