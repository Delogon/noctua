/**
 * Miniature Markdown for owl answers — exactly the subset the
 * models actually produce: **bold**, *italic*, `code`, - /1. lists,
 * ### headings and [n] source references. Deliberately without a dependency and
 * without HTML: the parser returns a structure, rendering uses React
 * elements (no dangerouslySetInnerHTML). Also works on half-finished
 * streaming texts — incomplete markup simply stays plain text.
 */

export type OwlInline =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'italic'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'source'; n: number }

export type OwlBlock =
  | { kind: 'paragraph'; lines: OwlInline[][] }
  | { kind: 'heading'; inlines: OwlInline[] }
  | { kind: 'list'; ordered: boolean; items: OwlInline[][] }

const INLINE_RE = /(\*\*([^*\n]+)\*\*)|(\*([^*\n]+)\*)|(`([^`\n]+)`)|(\[(\d{1,3})\])/g

/** Splits a line into inline pieces; incomplete markers stay text. */
export function parseInlines(line: string): OwlInline[] {
  const out: OwlInline[] = []
  let pos = 0
  for (const m of line.matchAll(INLINE_RE)) {
    if (m.index > pos) out.push({ kind: 'text', text: line.slice(pos, m.index) })
    if (m[2] !== undefined) out.push({ kind: 'bold', text: m[2] })
    else if (m[4] !== undefined) out.push({ kind: 'italic', text: m[4] })
    else if (m[6] !== undefined) out.push({ kind: 'code', text: m[6] })
    else out.push({ kind: 'source', n: Number(m[8]) })
    pos = m.index + m[0].length
  }
  if (pos < line.length) out.push({ kind: 'text', text: line.slice(pos) })
  return out
}

/**
 * Collects the [n] indices cited in the answer text — in order of first
 * occurrence, without duplicates. Uses the same parser as rendering:
 * it counts exactly what would be clickable there as a source reference (an [n] in
 * a code span, for instance, would not).
 */
export function citedSourceIndices(text: string): number[] {
  const seen = new Set<number>()
  const collect = (inlines: OwlInline[]): void => {
    for (const inline of inlines) if (inline.kind === 'source') seen.add(inline.n)
  }
  for (const block of parseOwlMarkdown(text)) {
    if (block.kind === 'heading') collect(block.inlines)
    else if (block.kind === 'list') block.items.forEach(collect)
    else block.lines.forEach(collect)
  }
  return [...seen]
}

const BULLET_RE = /^\s*[-*•]\s+(.*)$/
const ORDERED_RE = /^\s*\d{1,3}[.)]\s+(.*)$/
const HEADING_RE = /^#{1,4}\s+(.*)$/

/** Splits the answer text into blocks (paragraphs, lists, headings). */
export function parseOwlMarkdown(text: string): OwlBlock[] {
  const blocks: OwlBlock[] = []
  let paragraph: OwlInline[][] = []
  let list: { ordered: boolean; items: OwlInline[][] } | null = null

  const flushParagraph = (): void => {
    if (paragraph.length > 0) blocks.push({ kind: 'paragraph', lines: paragraph })
    paragraph = []
  }
  const flushList = (): void => {
    if (list) blocks.push({ kind: 'list', ordered: list.ordered, items: list.items })
    list = null
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    const heading = line.match(HEADING_RE)
    if (heading) {
      flushParagraph()
      flushList()
      blocks.push({ kind: 'heading', inlines: parseInlines(heading[1]) })
      continue
    }
    const bullet = line.match(BULLET_RE)
    const ordered = line.match(ORDERED_RE)
    if (bullet || ordered) {
      flushParagraph()
      const isOrdered = !ordered ? false : !bullet
      if (!list || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push(parseInlines((bullet ?? ordered)![1]))
      continue
    }
    flushList()
    // A full **bold** line acts like a subheading (common
    // model pattern) — start it as its own paragraph so it stands alone.
    if (/^\*\*[^*]+\*\*:?$/.test(line.trim())) {
      flushParagraph()
      blocks.push({ kind: 'heading', inlines: parseInlines(line.trim()) })
      continue
    }
    paragraph.push(parseInlines(line))
  }
  flushParagraph()
  flushList()
  return blocks
}
