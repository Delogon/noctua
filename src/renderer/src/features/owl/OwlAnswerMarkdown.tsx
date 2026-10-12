import { Fragment } from 'react'
import type { OwlSource } from '@shared/types'
import { parseOwlMarkdown, type OwlInline } from './owl-markdown'

/**
 * Renders an owl answer as React elements (no innerHTML). [n] references
 * become clickable as soon as the corresponding source exists — same jump logic
 * as the SOURCES card, passed in by the caller.
 */
export function OwlAnswerMarkdown({
  text,
  sources,
  onSourceJump
}: {
  text: string
  sources?: OwlSource[]
  onSourceJump: (source: OwlSource) => void
}): React.JSX.Element {
  const renderInline = (inline: OwlInline, key: number): React.JSX.Element => {
    if (inline.kind === 'bold') return <b key={key}>{inline.text}</b>
    if (inline.kind === 'italic') return <i key={key}>{inline.text}</i>
    if (inline.kind === 'code') return <code key={key}>{inline.text}</code>
    if (inline.kind === 'source') {
      const source = sources?.find((s) => s.index === inline.n)
      if (!source) return <Fragment key={key}>[{inline.n}]</Fragment>
      return (
        <button
          key={key}
          type="button"
          className="owl-md-source"
          title={source.subject ?? undefined}
          onClick={() => onSourceJump(source)}
        >
          [{inline.n}]
        </button>
      )
    }
    return <Fragment key={key}>{inline.text}</Fragment>
  }

  const renderLine = (inlines: OwlInline[], key: number, last: boolean): React.JSX.Element => (
    <Fragment key={key}>
      {inlines.map(renderInline)}
      {!last && <br />}
    </Fragment>
  )

  return (
    <>
      {parseOwlMarkdown(text).map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <p key={i} className="owl-md-heading">
              {block.inlines.map(renderInline)}
            </p>
          )
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, j) => <li key={j}>{item.map(renderInline)}</li>)
          return block.ordered ? (
            <ol key={i} className="owl-md-list">
              {items}
            </ol>
          ) : (
            <ul key={i} className="owl-md-list">
              {items}
            </ul>
          )
        }
        return (
          <p key={i} className="owl-md-paragraph">
            {block.lines.map((line, j) => renderLine(line, j, j === block.lines.length - 1))}
          </p>
        )
      })}
    </>
  )
}
