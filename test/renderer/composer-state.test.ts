import { describe, expect, it } from 'vitest'
import {
  appendTranscription,
  appendTranscriptionHtml,
  composerShortcut,
  estimateTranscriptSkeleton,
  textToComposerHtml
} from '@renderer/features/composer/composer-state'

function shortcut(
  key: string,
  overrides: Partial<{
    metaKey: boolean
    ctrlKey: boolean
    shiftKey: boolean
    isComposing: boolean
  }> = {}
): ReturnType<typeof composerShortcut> {
  return composerShortcut({
    key,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...overrides
  })
}

describe('estimateTranscriptSkeleton', () => {
  it('liefert fuer dieselbe Dauer immer dasselbe Skeleton', () => {
    expect(estimateTranscriptSkeleton(27)).toEqual(estimateTranscriptSkeleton(27))
    expect(estimateTranscriptSkeleton(27)).toEqual({
      lineCount: 6,
      widths: [94, 86, 91, 79, 94, 74]
    })
  })

  it('schaetzt pro fuenf Sekunden eine Textzeile', () => {
    expect(estimateTranscriptSkeleton(0).lineCount).toBe(1)
    expect(estimateTranscriptSkeleton(5).lineCount).toBe(1)
    expect(estimateTranscriptSkeleton(5.01).lineCount).toBe(2)
    expect(estimateTranscriptSkeleton(24).lineCount).toBe(5)
  })

  it('begrenzt die Zeilenzahl auf eins bis zwoelf', () => {
    for (const duration of [-20, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(estimateTranscriptSkeleton(duration)).toEqual({ lineCount: 1, widths: [38] })
    }

    const longRecording = estimateTranscriptSkeleton(10_000)
    expect(longRecording.lineCount).toBe(12)
    expect(longRecording.widths).toHaveLength(12)
  })

  it('liefert fuer jede Zeile eine plausible Prozentbreite', () => {
    for (const duration of [0, 1, 13, 59, 600]) {
      const skeleton = estimateTranscriptSkeleton(duration)
      expect(skeleton.widths).toHaveLength(skeleton.lineCount)
      expect(skeleton.widths.every((width) => width >= 38 && width <= 94)).toBe(true)
    }
  })
})

describe('appendTranscription', () => {
  it('setzt ein Diktat in ein leeres Textfeld ein', () => {
    expect(appendTranscription('', '  Hallo Nele.  ')).toBe('Hallo Nele.')
  })

  it('haengt ein Diktat mit einer Leerzeile an vorhandenen Text an', () => {
    expect(appendTranscription('Hallo Nele,  ', '\nwir sehen uns morgen.\n')).toBe(
      'Hallo Nele,\n\nwir sehen uns morgen.'
    )
  })

  it('veraendert bei leerem Diktat den Inhalt nicht und entfernt nur End-Leerraum', () => {
    expect(appendTranscription('  Bestehender Text\n\n', '   \n')).toBe('  Bestehender Text')
  })
})

describe('textToComposerHtml', () => {
  it('wandelt Zeilenumbrüche in die Block-Struktur des Editors um', () => {
    expect(textToComposerHtml('Hallo Alice,\nkommt sofort.')).toBe(
      '<div>Hallo Alice,</div><div>kommt sofort.</div>'
    )
  })

  it('erhält Leerzeilen als eigene Blöcke (Absätze überleben den Versand)', () => {
    expect(textToComposerHtml('Hallo,\n\nviele Grüße')).toBe(
      '<div>Hallo,</div><div><br></div><div>viele Grüße</div>'
    )
  })

  it('escaped HTML-Sonderzeichen im Text', () => {
    expect(textToComposerHtml('1 < 2 & "x"')).toBe('<div>1 &lt; 2 &amp; &quot;x&quot;</div>')
  })

  it('liefert für leeren Text einen leeren String', () => {
    expect(textToComposerHtml('')).toBe('')
  })
})

describe('appendTranscriptionHtml', () => {
  it('escaped ein Diktat, bevor es als HTML eingefuegt wird', () => {
    expect(appendTranscriptionHtml('', `Tom & <Nele> sagen: "Ja" und 'Nein'`)).toBe(
      '<div>Tom &amp; &lt;Nele&gt; sagen: &quot;Ja&quot; und &#039;Nein&#039;</div>'
    )
  })

  it('behaelt vorhandene Formatierung und setzt das Diktat danach ein', () => {
    const currentHtml = '<div><strong>Hallo Nele,</strong></div>'
    expect(appendTranscriptionHtml(currentHtml, 'bis morgen.')).toBe(
      `${currentHtml}<div><br></div><div>bis morgen.</div>`
    )
  })

  it('bildet Leerzeilen im Diktat als leere HTML-Zeilen ab', () => {
    expect(appendTranscriptionHtml('', 'Erste Zeile\n\nDritte Zeile')).toBe(
      '<div>Erste Zeile</div><div><br></div><div>Dritte Zeile</div>'
    )
  })

  it('laesst vorhandenes HTML bei einem leeren Diktat unveraendert', () => {
    const currentHtml = '  <div>Bestehender Text</div>  '
    expect(appendTranscriptionHtml(currentHtml, '  \n')).toBe(currentHtml)
  })
})

describe('composerShortcut', () => {
  it('reagiert im fokussierten Editor nicht auf einzelne Buchstaben', () => {
    expect(shortcut('d')).toBeNull()
    expect(shortcut('j')).toBeNull()
    expect(shortcut('f')).toBeNull()
    expect(shortcut('Enter')).toBeNull()
  })

  it('erkennt die macOS-Shortcuts mit Command', () => {
    expect(shortcut('Enter', { metaKey: true })).toBe('send')
    expect(shortcut('D', { metaKey: true })).toBe('dictate')
    expect(shortcut('j', { metaKey: true })).toBe('generate')
    expect(shortcut('f', { metaKey: true, shiftKey: true })).toBe('format')
  })

  it('unterstuetzt die gleichen Modifier-Shortcuts mit Control', () => {
    expect(shortcut('Enter', { ctrlKey: true })).toBe('send')
    expect(shortcut('d', { ctrlKey: true })).toBe('dictate')
    expect(shortcut('j', { ctrlKey: true })).toBe('generate')
    expect(shortcut('F', { ctrlKey: true, shiftKey: true })).toBe('format')
  })

  it('ignoriert nicht belegte Shift-Varianten', () => {
    expect(shortcut('d', { metaKey: true, shiftKey: true })).toBeNull()
    expect(shortcut('j', { metaKey: true, shiftKey: true })).toBeNull()
    expect(shortcut('f', { metaKey: true })).toBeNull()
  })

  it('⌘⇧A schaltet den Antwort-Umfang (M84)', () => {
    expect(shortcut('a', { metaKey: true, shiftKey: true })).toBe('replyScope')
    expect(shortcut('A', { metaKey: true, shiftKey: true })).toBe('replyScope')
    expect(shortcut('A', { ctrlKey: true, shiftKey: true })).toBe('replyScope')
  })

  it('⌘A (Alles auswählen) und ⇧A allein bleiben frei', () => {
    expect(shortcut('a', { metaKey: true })).toBeNull()
    expect(shortcut('A', { shiftKey: true })).toBeNull()
  })

  it('bricht mit Escape ohne Modifier ab', () => {
    expect(shortcut('Escape')).toBe('cancel')
  })

  it('loest waehrend einer laufenden Texteingabe-Komposition nichts aus', () => {
    expect(shortcut('Enter', { metaKey: true, isComposing: true })).toBeNull()
    expect(shortcut('Escape', { isComposing: true })).toBeNull()
  })
})
