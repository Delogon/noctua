/**
 * Folder roles: IMAP SPECIAL-USE is optional — many servers (and older
 * Exchange/Dovecot setups) deliver Junk, Trash & co. only as names.
 * Without a flag a "Junk-E-Mail" folder would otherwise show up as a normal
 * folder. The role drives sync mode, folder tree and spam exclusion.
 */

export type FolderRole = 'inbox' | 'sent' | 'drafts' | 'archive' | 'junk' | 'trash' | 'other'

const ROLE_BY_SPECIAL_USE: Record<string, FolderRole> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Archive': 'archive',
  '\\Junk': 'junk',
  '\\Trash': 'trash'
}

const SPECIAL_USE_BY_ROLE: Partial<Record<FolderRole, string>> = {
  sent: '\\Sent',
  drafts: '\\Drafts',
  archive: '\\Archive',
  junk: '\\Junk',
  trash: '\\Trash'
}

/** Known folder names (lowercase, last path segment) per role. */
const ROLE_NAMES: Array<[FolderRole, string[]]> = [
  [
    'junk',
    [
      'junk',
      'spam',
      'junk mail',
      'junk e-mail',
      'junk email',
      'junk-e-mail',
      'bulk mail',
      'spam-verdacht',
      'spamverdacht',
      'unerwünscht',
      'courrier indésirable',
      'correo no deseado'
    ]
  ],
  [
    'trash',
    [
      'trash',
      'bin',
      'deleted',
      'deleted items',
      'deleted messages',
      'papierkorb',
      'gelöschte elemente',
      'gelöschte objekte',
      'gelöscht'
    ]
  ],
  [
    'sent',
    [
      'sent',
      'sent items',
      'sent mail',
      'sent messages',
      'gesendet',
      'gesendete elemente',
      'gesendete objekte'
    ]
  ],
  ['drafts', ['drafts', 'draft', 'entwürfe', 'entwurf']],
  ['archive', ['archive', 'archiv', 'archives']]
]

export function folderRole(specialUse: string | null | undefined): FolderRole {
  return (specialUse && ROLE_BY_SPECIAL_USE[specialUse]) || 'other'
}

/** Last path segment — a folder's display name. */
export function folderLeaf(path: string, delimiter: string | null | undefined): string {
  if (!delimiter) return path
  const parts = path.split(delimiter)
  return parts[parts.length - 1] || path
}

/** Role from the name alone; only for top-level folders or directly under INBOX/[Gmail]. */
export function roleFromName(path: string, delimiter: string | null | undefined): FolderRole {
  const parts = delimiter ? path.split(delimiter) : [path]
  if (parts.length > 2) return 'other'
  if (parts.length === 2) {
    const parent = parts[0].toLowerCase()
    if (parent !== 'inbox' && parent !== '[gmail]' && parent !== '[google mail]') return 'other'
  }
  const leaf = parts[parts.length - 1].trim().toLowerCase()
  for (const [role, names] of ROLE_NAMES) {
    if (names.includes(leaf)) return role
  }
  return 'other'
}

/**
 * Fill in SPECIAL-USE for a whole LIST response. Server flags always win.
 * Junk is detected by name even if a \Junk folder already exists (better to
 * filter spam once too often); the other roles only if the server doesn't
 * report them at all — otherwise there would be two "Sent".
 */
export function inferSpecialUses(
  boxes: Array<{ path: string; delimiter?: string | null; specialUse?: string | null }>
): Array<string | null> {
  const flagged = new Set(boxes.map((b) => b.specialUse).filter(Boolean))
  const claimed = new Set<string>()
  return boxes.map((box) => {
    if (box.path.toUpperCase() === 'INBOX') return '\\Inbox'
    if (box.specialUse) return box.specialUse
    const role = roleFromName(box.path, box.delimiter)
    const special = SPECIAL_USE_BY_ROLE[role]
    if (!special) return null
    if (role === 'junk') return special
    if (flagged.has(special) || claimed.has(special)) return null
    claimed.add(special)
    return special
  })
}
