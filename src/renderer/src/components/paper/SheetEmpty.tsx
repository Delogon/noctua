import { OwlGlyph } from '@renderer/components/paper/OwlGlyph'

/**
 * Quiet empty state for the center sheet: sleeping owl stamp above an
 * italic serif line + mono sub on paper background — "nothing needs you".
 */
export function SheetEmpty({ line, sub }: { line: string; sub: string }): React.JSX.Element {
  return (
    <div className="flex flex-1 flex-col items-center justify-center" style={{ padding: 24 }}>
      <div style={{ marginBottom: 10 }}>
        <OwlGlyph pose="asleep" size={30} />
      </div>
      <div
        style={{ font: '400 16px var(--serif)', fontStyle: 'italic', color: 'var(--secondary)' }}
      >
        {line}
      </div>
      <div className="mmeta" style={{ color: 'var(--faint)', marginTop: 8 }}>
        {sub}
      </div>
    </div>
  )
}
