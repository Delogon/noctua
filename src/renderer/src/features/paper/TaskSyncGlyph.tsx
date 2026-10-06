import { useT } from '@renderer/lib/i18n'
import type { TaskItem } from '@shared/types'

// Kleine Sync-Glyphe der CalDAV-Aufgabenliste: ○ wartet, ● synchron, ! Konflikt.
// Nicht zugeordnete Aufgaben (Abgleich aus) zeigen nichts.

const GLYPH = { pending: '○', synced: '●', conflict: '!' } as const

export function TaskSyncGlyph({
  state
}: {
  state: TaskItem['syncState']
}): React.JSX.Element | null {
  const t = useT()
  if (!state) return null
  const label =
    state === 'pending'
      ? t('taskSyncPending')
      : state === 'synced'
        ? t('taskSyncSynced')
        : t('taskSyncConflict')
  return (
    <span
      className="flex-none"
      role="img"
      aria-label={label}
      title={label}
      style={{
        font: '500 9px var(--mono)',
        color: state === 'conflict' ? 'var(--ac)' : 'var(--faint)'
      }}
    >
      {GLYPH[state]}
    </span>
  )
}
