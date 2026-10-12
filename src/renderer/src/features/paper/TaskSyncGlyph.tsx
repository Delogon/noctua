import { useT } from '@renderer/lib/i18n'
import type { TaskItem } from '@shared/types'

// Small sync glyph of the CalDAV task list: ○ pending, ● in sync, ! conflict.
// Unassigned tasks (sync off) show nothing.

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
