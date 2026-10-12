import type { FolderListItem } from '@shared/types'

/**
 * Reihenfolge und Einrückung des Ordnerbaums eines Kontos (wie in Outlook):
 * Posteingang mit seinen Unterordnern, Gesendet, Archiv, dann die eigenen
 * Ordner alphabetisch nach Pfad — Spam immer zuletzt. Entwürfe/Papierkorb
 * sind nicht voll synchronisiert und fehlen bewusst.
 */
export function folderTreeEntries(
  folders: FolderListItem[]
): Array<{ folder: FolderListItem; depth: number }> {
  const inbox = folders.find((f) => f.role === 'inbox')
  const segments = (f: FolderListItem): string[] =>
    f.delimiter ? f.path.split(f.delimiter) : [f.path]
  const underInbox = (f: FolderListItem): boolean =>
    Boolean(inbox && f.delimiter && f.path.startsWith(inbox.path + f.delimiter))
  const byPath = (a: FolderListItem, b: FolderListItem): number =>
    a.path.localeCompare(b.path, undefined, { sensitivity: 'base' })

  const others = folders.filter((f) => f.role === 'other')
  const out: Array<{ folder: FolderListItem; depth: number }> = []
  if (inbox) {
    out.push({ folder: inbox, depth: 0 })
    for (const f of others.filter(underInbox).sort(byPath)) {
      out.push({ folder: f, depth: segments(f).length - segments(inbox).length })
    }
  }
  for (const role of ['sent', 'archive'] as const) {
    for (const f of folders.filter((x) => x.role === role).sort(byPath)) {
      out.push({ folder: f, depth: 0 })
    }
  }
  for (const f of others.filter((x) => !underInbox(x)).sort(byPath)) {
    out.push({ folder: f, depth: segments(f).length - 1 })
  }
  for (const f of folders.filter((x) => x.role === 'junk').sort(byPath)) {
    out.push({ folder: f, depth: 0 })
  }
  return out
}
