/**
 * Ordner-Rollen: IMAP SPECIAL-USE ist optional — viele Server (und ältere
 * Exchange-/Dovecot-Setups) liefern Junk, Papierkorb & Co. nur als Namen.
 * Ohne Flag landete ein „Junk-E-Mail"-Ordner sonst als normaler Ordner in
 * der Ansicht. Die Rolle steuert Sync-Modus, Ordnerbaum und Spam-Ausschluss.
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

/** Bekannte Ordnernamen (kleingeschrieben, letzter Pfadteil) je Rolle. */
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

/** Letzter Pfadteil — der Anzeigename eines Ordners. */
export function folderLeaf(path: string, delimiter: string | null | undefined): string {
  if (!delimiter) return path
  const parts = path.split(delimiter)
  return parts[parts.length - 1] || path
}

/** Rolle allein aus dem Namen; nur für Ordner auf oberster Ebene oder direkt unter INBOX/[Gmail]. */
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
 * SPECIAL-USE für eine ganze LIST-Antwort ergänzen. Server-Flags gewinnen
 * immer. Junk wird per Name auch dann erkannt, wenn schon ein \Junk-Ordner
 * existiert (Spam lieber einmal zu viel aussortieren); die übrigen Rollen nur,
 * wenn der Server sie gar nicht meldet — sonst gäbe es zwei „Gesendet".
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
