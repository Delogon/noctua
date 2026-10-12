import { describe, it, expect } from 'vitest'
import {
  parseOwlMarkdown,
  parseInlines,
  citedSourceIndices
} from '@renderer/features/owl/owl-markdown'

describe('parseInlines', () => {
  it('erkennt fett, kursiv, Code und Quellenverweise', () => {
    expect(parseInlines('Siehe **Bestellung** [4] mit `code` und *kursiv*.')).toEqual([
      { kind: 'text', text: 'Siehe ' },
      { kind: 'bold', text: 'Bestellung' },
      { kind: 'text', text: ' ' },
      { kind: 'source', n: 4 },
      { kind: 'text', text: ' mit ' },
      { kind: 'code', text: 'code' },
      { kind: 'text', text: ' und ' },
      { kind: 'italic', text: 'kursiv' },
      { kind: 'text', text: '.' }
    ])
  })

  it('lässt unvollständige Marker als Klartext stehen (Streaming)', () => {
    expect(parseInlines('Das ist **noch offe')).toEqual([
      { kind: 'text', text: 'Das ist **noch offe' }
    ])
  })

  it('verwechselt Datumsklammern nicht mit Quellen', () => {
    expect(parseInlines('[abc] und [12]')).toEqual([
      { kind: 'text', text: '[abc] und ' },
      { kind: 'source', n: 12 }
    ])
  })
})

describe('parseOwlMarkdown', () => {
  it('gruppiert Spiegelstriche zu einer Liste', () => {
    const blocks = parseOwlMarkdown('Intro:\n- [3] Erste Mail\n- [4] Zweite Mail\n\nDanach.')
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list', 'paragraph'])
    const list = blocks[1] as Extract<(typeof blocks)[1], { kind: 'list' }>
    expect(list.ordered).toBe(false)
    expect(list.items).toHaveLength(2)
    expect(list.items[0][0]).toEqual({ kind: 'source', n: 3 })
  })

  it('behandelt volle Fett-Zeilen als Zwischenüberschrift', () => {
    const blocks = parseOwlMarkdown('**Bestellungen / Formulare**\n- eins')
    expect(blocks[0].kind).toBe('heading')
    expect(blocks[1].kind).toBe('list')
  })

  it('erkennt nummerierte Listen und #-Überschriften', () => {
    const blocks = parseOwlMarkdown('## Ablauf\n1. erst\n2. dann')
    expect(blocks[0].kind).toBe('heading')
    const list = blocks[1] as Extract<(typeof blocks)[1], { kind: 'list' }>
    expect(list.ordered).toBe(true)
    expect(list.items).toHaveLength(2)
  })

  it('hält Zeilen eines Absatzes zusammen und trennt an Leerzeilen', () => {
    const blocks = parseOwlMarkdown('Zeile eins\nZeile zwei\n\nNeuer Absatz')
    expect(blocks).toHaveLength(2)
    const p = blocks[0] as Extract<(typeof blocks)[0], { kind: 'paragraph' }>
    expect(p.lines).toHaveLength(2)
  })

  it('kommt mit leerem Text zurecht', () => {
    expect(parseOwlMarkdown('')).toEqual([])
  })
})

describe('citedSourceIndices', () => {
  it('sammelt Verweise in Auftrittsreihenfolge und dedupliziert', () => {
    expect(citedSourceIndices('Die Warnung [4][7] kam am 3. Juli [4].')).toEqual([4, 7])
  })

  it('liefert leer, wenn die Antwort nichts zitiert', () => {
    expect(citedSourceIndices('Dazu steht nichts in deinen Mails.')).toEqual([])
    expect(citedSourceIndices('')).toEqual([])
  })

  it('findet Verweise auch in Listen und Überschriften', () => {
    expect(citedSourceIndices('## Fund [2]\n- Rechnung [5]\n1. Termin [9]')).toEqual([2, 5, 9])
  })

  it('zählt nur, was das Rendering als Verweis zeigt', () => {
    // In a code span and as a non-number, [n] stays plain text — as when rendering.
    expect(citedSourceIndices('siehe `[3]` und [abc]')).toEqual([])
  })
})
