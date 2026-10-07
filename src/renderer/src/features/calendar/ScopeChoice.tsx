import type { CalendarEditScope } from '@shared/calendar-types'
import type { StringKey } from '@renderer/i18n/strings'
import { useT } from '@renderer/lib/i18n'
import { SCOPE_ORDER } from './scope'

// Bereichswahl für Serien: „Nur dieser Termin / Dieser und folgende / Alle Termine".

const LABELS: Record<'edit' | 'delete', Record<CalendarEditScope, StringKey>> = {
  edit: { this: 'cvScopeThis', following: 'cvScopeFollowing', all: 'cvScopeAll' },
  delete: { this: 'cvScopeThis', following: 'cvScopeFollowing', all: 'cvScopeAll' }
}

export function ScopeChoice({
  kind,
  busy,
  onChoose,
  onCancel
}: {
  kind: 'edit' | 'delete'
  busy: boolean
  onChoose: (scope: CalendarEditScope) => void
  onCancel: () => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div role="group" aria-label={t(kind === 'edit' ? 'cvScopeEditHead' : 'cvScopeDeleteHead')}>
      <div className="mlabel" style={{ color: 'var(--ac)', marginBottom: 8 }}>
        {t(kind === 'edit' ? 'cvScopeEditHead' : 'cvScopeDeleteHead')}
      </div>
      <div className="flex flex-col gap-1.5">
        {SCOPE_ORDER.map((scope) => (
          <button
            key={scope}
            type="button"
            className="cal-scope-btn"
            disabled={busy}
            onClick={() => onChoose(scope)}
          >
            {t(LABELS[kind][scope])}
          </button>
        ))}
      </div>
      <button type="button" className="text-btn" style={{ marginTop: 6 }} onClick={onCancel}>
        {t('cancel')}
      </button>
    </div>
  )
}
