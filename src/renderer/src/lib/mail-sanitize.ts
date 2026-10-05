/**
 * Reine Helfer für das Mail-Sanitizing (ohne DOM, damit unit-testbar):
 * Inline-Style-Filter und Tracking-Pixel-Erkennung.
 */

/** Deklarationen, die Netz-Requests auslösen oder die Mail aus ihrem Kasten lösen. */
const FORBIDDEN_DECLARATION = [
  /url\s*\(/i,
  /image-set\s*\(/i,
  /@import/i,
  /expression\s*\(/i,
  /-moz-binding/i,
  /behavior\s*:/i,
  // CSS-Escapes (u\72l(…)) könnten die Muster oben umgehen
  /\\/,
  /(?:^|;|\s)position\s*:\s*(?:fixed|sticky)/i
]

/** Teilt an ';' außerhalb von Klammern und Anführungszeichen. */
function splitDeclarations(style: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let current = ''
  for (const ch of style) {
    if (quote) {
      if (ch === quote) quote = null
    } else if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')') depth = Math.max(0, depth - 1)
    else if (ch === ';' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
}

/** Entfernt gefährliche Deklarationen aus einem style-Attribut; Rest bleibt erhalten. */
export function sanitizeInlineStyle(style: string): string {
  const withoutComments = style.replace(/\/\*[\s\S]*?\*\//g, '')
  return splitDeclarations(withoutComments)
    .map((decl) => decl.trim())
    .filter((decl) => decl !== '' && !FORBIDDEN_DECLARATION.some((re) => re.test(decl)))
    .join('; ')
}

function styleProp(style: string, prop: string): string | null {
  for (const decl of splitDeclarations(style)) {
    const idx = decl.indexOf(':')
    if (idx > 0 && decl.slice(0, idx).trim().toLowerCase() === prop) {
      return decl
        .slice(idx + 1)
        .trim()
        .toLowerCase()
    }
  }
  return null
}

/** Wert ("1", "2px", "1.5") als Pixelzahl, sonst null (z. B. "100%", "auto"). */
function pixels(value: string | null | undefined): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value ?? '')
  return match ? Number(match[1]) : null
}

/** CSP im srcdoc: standardmäßig nichts laden außer data:/cid:-Bildern; https nur nach Freigabe. */
export function mailFrameCsp(remoteAllowed: boolean): string {
  const img = remoteAllowed ? 'data: cid: https:' : 'data: cid:'
  return `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'`
}

/** Optik der Mail-Fläche (vorher Tailwind-Klassen am Container, jetzt im Frame). */
const FRAME_CSS = `
html{display:flow-root}
body{display:flow-root;margin:0;padding:16px 20px;overflow-x:hidden;font:14px/1.625 Newsreader,Georgia,serif;color:#26221a;overflow-wrap:break-word}
a{color:#1d4ed8;text-decoration:underline}
img{height:auto;max-width:100%}
img[data-blocked]{display:inline-block;min-width:24px;min-height:24px;border:1px dashed #d4d4d4;border-radius:4px;background:#f5f5f5}
table{max-width:100%}
`

/** Baut das srcdoc-Dokument für den sandboxed Mail-iframe (Body ist bereits sanitisiert). */
export function buildMailSrcdoc(bodyHtml: string, remoteAllowed: boolean): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${mailFrameCsp(remoteAllowed)}">` +
    `<style>${FRAME_CSS}</style></head><body>${bodyHtml}</body></html>`
  )
}

/** Winzige oder versteckte Bilder (1x1, ≤2px, display:none) sind Tracking-Pixel. */
export function isTrackingPixel(attrs: {
  width?: string | null
  height?: string | null
  style?: string | null
}): boolean {
  const style = attrs.style ?? ''
  if (styleProp(style, 'display') === 'none' || styleProp(style, 'visibility') === 'hidden') {
    return true
  }
  const width = pixels(attrs.width) ?? pixels(styleProp(style, 'width'))
  const height = pixels(attrs.height) ?? pixels(styleProp(style, 'height'))
  return (width !== null && width <= 2) || (height !== null && height <= 2)
}
