import { useCallback, useEffect, useRef, useState } from 'react'
import { findMisspellings, ignoreWord, suggestionsFor } from '@renderer/lib/spell'
import { useT } from '@renderer/lib/i18n'

/**
 * Spell checking for the contentEditable composer: misspelled words are
 * marked with a squiggle via the CSS Custom Highlight API (no
 * overlay, no DOM rework — the ranges move along automatically while typing),
 * hover opens correction suggestions, click replaces the word in the editor.
 * Checking happens in the main process (Hunspell DE+EN, see src/main/spell/).
 */

const HIGHLIGHT_NAME = 'spell-miss'

// The compose page and reply composer can be mounted at the same time —
// all instances feed their ranges into the one global highlight.
const highlightRegistry = new Map<number, Range[]>()
let nextInstanceId = 1

function publishHighlights(): void {
  if (typeof Highlight === 'undefined' || !CSS.highlights) return
  const all = [...highlightRegistry.values()].flat()
  if (all.length === 0) CSS.highlights.delete(HIGHLIGHT_NAME)
  else CSS.highlights.set(HIGHLIGHT_NAME, new Highlight(...all))
}

interface DomMark {
  word: string
  range: Range
}

interface Segment {
  node: Text
  start: number
}

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE', 'TR'])

/**
 * Reads the editor text as one string and remembers which text node
 * starts at which offset. Block boundaries and <br> count as \n so that
 * words on adjacent lines don't stick together; inline formatting
 * (b/i/u/font/a) stays invisible — a word may span across it.
 */
function extractText(root: HTMLElement): { text: string; segments: Segment[] } {
  const segments: Segment[] = []
  let text = ''
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        segments.push({ node: child as Text, start: text.length })
        text += (child as Text).data
      } else if (child.nodeName === 'BR') {
        text += '\n'
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        visit(child)
        if (BLOCK_TAGS.has(child.nodeName)) text += '\n'
      }
    }
  }
  visit(root)
  return { text, segments }
}

/** Builds a DOM range from virtual text offsets (possibly across inline tags). */
function rangeFromOffsets(segments: Segment[], start: number, end: number): Range | null {
  let startSeg: Segment | null = null
  let endSeg: Segment | null = null
  for (const seg of segments) {
    const len = seg.node.data.length
    if (!startSeg && start >= seg.start && start < seg.start + len) startSeg = seg
    if (!endSeg && end > seg.start && end <= seg.start + len) endSeg = seg
  }
  if (!startSeg || !endSeg) return null
  const range = document.createRange()
  range.setStart(startSeg.node, start - startSeg.start)
  range.setEnd(endSeg.node, end - endSeg.start)
  return range
}

/** Virtual offset of the (collapsed) cursor, otherwise null. */
function caretOffset(root: HTMLElement, segments: Segment[]): number | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null
  const { focusNode, focusOffset } = sel
  if (!focusNode || focusNode.nodeType !== Node.TEXT_NODE || !root.contains(focusNode)) return null
  const seg = segments.find((s) => s.node === focusNode)
  return seg ? seg.start + focusOffset : null
}

interface Tip {
  mark: DomMark
  left: number
  top: number
  below: boolean
  /** null = suggestions still loading */
  suggestions: string[] | null
}

interface ComposerSpellcheckProps {
  editorRef: React.RefObject<HTMLDivElement | null>
  /** Current composer text — serves as the trigger for the check run */
  text: string
  disabled: boolean
  /** After a replacement in the DOM: re-read the composer state (emitDocument) */
  onDidEdit: () => void
}

export function ComposerSpellcheck({
  editorRef,
  text,
  disabled,
  onDidEdit
}: ComposerSpellcheckProps): React.JSX.Element | null {
  const t = useT()
  const [instanceId] = useState(() => nextInstanceId++)
  const marksRef = useRef<DomMark[]>([])
  const runIdRef = useRef(0)
  const debounceRef = useRef<number>(undefined)
  const hideTimerRef = useRef<number>(undefined)
  const hoverRafRef = useRef(0)
  const [tip, setTip] = useState<Tip | null>(null)

  const setMarks = useCallback(
    (marks: DomMark[]) => {
      marksRef.current = marks
      highlightRegistry.set(
        instanceId,
        marks.map((m) => m.range)
      )
      publishHighlights()
    },
    [instanceId]
  )

  const runCheck = useCallback(
    (immediate = false) => {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = window.setTimeout(
        () => {
          const editor = editorRef.current
          if (!editor) return
          const runId = ++runIdRef.current
          const { text: snapshot, segments } = extractText(editor)
          void findMisspellings(snapshot)
            .then((found) => {
              // Discarded if a new run or different text applies by now
              if (runId !== runIdRef.current) return
              if (extractText(editor).text !== snapshot) return
              // The word at the cursor stays unmarked while typing
              const caret = document.activeElement === editor ? caretOffset(editor, segments) : null
              const marks: DomMark[] = []
              for (const m of found) {
                if (caret !== null && m.start <= caret && caret <= m.end) continue
                const range = rangeFromOffsets(segments, m.start, m.end)
                if (range) marks.push({ word: m.word, range })
              }
              setMarks(marks)
            })
            .catch(() => {})
        },
        immediate ? 0 : 400
      )
    },
    [editorRef, setMarks]
  )

  // Text change or lock: close the tooltip (derived state, no effect)
  const [prevTrigger, setPrevTrigger] = useState({ text, disabled })
  if (prevTrigger.text !== text || prevTrigger.disabled !== disabled) {
    setPrevTrigger({ text, disabled })
    setTip(null)
  }

  useEffect(() => {
    if (disabled) {
      setMarks([])
      return
    }
    runCheck()
  }, [text, disabled, runCheck, setMarks])

  // Clean up on unmount: remove own ranges from the global highlight
  useEffect(
    () => () => {
      window.clearTimeout(debounceRef.current)
      window.clearTimeout(hideTimerRef.current)
      cancelAnimationFrame(hoverRafRef.current)
      highlightRegistry.delete(instanceId)
      publishHighlights()
    },
    [instanceId]
  )

  // Pointer is currently over the tooltip: then NO trailing hit test
  // or timer may close it. The last mousemove on the editor
  // before moving into the tooltip no longer hits a word — its rAF callback
  // would otherwise run after the tooltip's mouseenter and hide it again.
  const tipHoveredRef = useRef(false)

  const cancelHide = useCallback(() => window.clearTimeout(hideTimerRef.current), [])
  const scheduleHide = useCallback(() => {
    cancelHide()
    hideTimerRef.current = window.setTimeout(() => {
      if (tipHoveredRef.current) return
      setTip(null)
    }, 250)
  }, [cancelHide])

  // If the tooltip closes (replace, ignore, typing) without the pointer
  // leaving it, no mouseleave fires anymore — reset the flag here.
  useEffect(() => {
    if (!tip) tipHoveredRef.current = false
  }, [tip])

  const showTip = useCallback(
    (mark: DomMark, rect: DOMRect) => {
      cancelHide()
      const editor = editorRef.current
      const shell = editor?.parentElement
      if (!shell) return
      setTip((cur) => {
        if (cur && cur.mark === mark) return cur
        const sr = shell.getBoundingClientRect()
        const below = rect.top - sr.top < 56
        return {
          mark,
          left: Math.max(0, Math.min(rect.left - sr.left + shell.scrollLeft, sr.width - 180)),
          top: below
            ? rect.bottom - sr.top + shell.scrollTop + 5
            : rect.top - sr.top + shell.scrollTop - 5,
          below,
          suggestions: null
        }
      })
    },
    [cancelHide, editorRef]
  )

  // Hover detection via the range rects (highlights have no events)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    const shell = editor.parentElement
    const onMove = (ev: MouseEvent): void => {
      if (marksRef.current.length === 0) return
      const { clientX: x, clientY: y } = ev
      cancelAnimationFrame(hoverRafRef.current)
      hoverRafRef.current = requestAnimationFrame(() => {
        if (tipHoveredRef.current) return
        for (const mark of marksRef.current) {
          for (const r of mark.range.getClientRects()) {
            if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 2 && y <= r.bottom + 2) {
              showTip(mark, r)
              return
            }
          }
        }
        scheduleHide()
      })
    }
    const onLeave = (): void => scheduleHide()
    const onScroll = (): void => setTip(null)
    const onBlur = (): void => runCheck(true)
    const onKeyUp = (): void => runCheck()
    const onKeyDown = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' && marksRef.current.length > 0) {
        setTip((cur) => {
          if (cur) {
            ev.preventDefault()
            ev.stopPropagation()
          }
          return null
        })
      }
    }
    editor.addEventListener('mousemove', onMove)
    editor.addEventListener('mouseleave', onLeave)
    editor.addEventListener('blur', onBlur)
    editor.addEventListener('keyup', onKeyUp)
    editor.addEventListener('keydown', onKeyDown)
    shell?.addEventListener('scroll', onScroll)
    return () => {
      editor.removeEventListener('mousemove', onMove)
      editor.removeEventListener('mouseleave', onLeave)
      editor.removeEventListener('blur', onBlur)
      editor.removeEventListener('keyup', onKeyUp)
      editor.removeEventListener('keydown', onKeyDown)
      shell?.removeEventListener('scroll', onScroll)
    }
  }, [editorRef, showTip, scheduleHide, runCheck])

  // Lazily load suggestions as soon as a tooltip has opened
  useEffect(() => {
    if (!tip || tip.suggestions !== null) return
    const word = tip.mark.word
    let alive = true
    suggestionsFor(word)
      .then((suggestions) => {
        if (!alive) return
        setTip((cur) => (cur && cur.mark.word === word ? { ...cur, suggestions } : cur))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [tip])

  const applySuggestion = useCallback(
    (suggestion: string) => {
      const cur = tip
      const editor = editorRef.current
      if (!cur || !editor) return
      setTip(null)
      const { range, word } = cur.mark
      // DOM changed in the meantime? Then re-check rather than replace wrongly.
      if (range.toString() !== word) {
        runCheck(true)
        return
      }
      range.deleteContents()
      const node = document.createTextNode(suggestion)
      range.insertNode(node)
      editor.focus()
      const sel = window.getSelection()
      if (sel) {
        const after = document.createRange()
        after.setStart(node, suggestion.length)
        after.collapse(true)
        sel.removeAllRanges()
        sel.addRange(after)
      }
      setMarks(marksRef.current.filter((m) => m !== cur.mark))
      onDidEdit()
    },
    [tip, editorRef, runCheck, setMarks, onDidEdit]
  )

  const ignoreTipWord = useCallback(() => {
    if (!tip) return
    const word = tip.mark.word
    ignoreWord(word)
    setMarks(marksRef.current.filter((m) => m.word !== word))
    setTip(null)
  }, [tip, setMarks])

  if (!tip) return null
  return (
    <div
      className="suggest-pop spell-tip"
      style={{
        left: tip.left,
        top: tip.top,
        transform: tip.below ? undefined : 'translateY(-100%)'
      }}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={() => {
        tipHoveredRef.current = true
        cancelAnimationFrame(hoverRafRef.current)
        cancelHide()
      }}
      onMouseLeave={() => {
        tipHoveredRef.current = false
        scheduleHide()
      }}
    >
      {tip.suggestions?.slice(0, 3).map((s) => (
        <button
          key={s}
          type="button"
          className="spell-tip-item"
          onMouseDown={(e) => {
            e.preventDefault()
            applySuggestion(s)
          }}
        >
          {s}
        </button>
      ))}
      {tip.suggestions?.length === 0 && (
        <span className="spell-tip-empty">{t('spellNoSuggestions')}</span>
      )}
      <button
        type="button"
        className="spell-tip-ignore"
        onMouseDown={(e) => {
          e.preventDefault()
          ignoreTipWord()
        }}
      >
        {t('spellIgnore')}
      </button>
    </div>
  )
}
