/**
 * Pure helpers for mail sanitizing (without DOM, so unit-testable):
 * inline style filter and tracking pixel detection.
 */

/** Declarations that trigger network requests or lift the mail out of its box. */
const FORBIDDEN_DECLARATION = [
  /url\s*\(/i,
  /image-set\s*\(/i,
  /@import/i,
  /expression\s*\(/i,
  /-moz-binding/i,
  /behavior\s*:/i,
  // CSS escapes (u\72l(…)) could bypass the patterns above
  /\\/,
  /(?:^|;|\s)position\s*:\s*(?:fixed|sticky)/i
]

/** Splits at ';' outside of parentheses and quotes. */
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

/** Removes dangerous declarations from a style attribute; the rest is kept. */
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

/** Value ("1", "2px", "1.5") as a pixel number, otherwise null (e.g. "100%", "auto"). */
function pixels(value: string | null | undefined): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(value ?? '')
  return match ? Number(match[1]) : null
}

/** CSP in srcdoc: by default load nothing except data:/cid: images; https only after approval. */
export function mailFrameCsp(remoteAllowed: boolean): string {
  const img = remoteAllowed ? 'data: cid: https:' : 'data: cid:'
  return `default-src 'none'; img-src ${img}; style-src 'unsafe-inline'`
}

/** Look of the mail surface (previously Tailwind classes on the container, now in the frame). */
const FRAME_CSS = `
html{display:flow-root}
body{display:flow-root;margin:0;padding:16px 20px;overflow-x:hidden;font:14px/1.625 Newsreader,Georgia,serif;color:#26221a;overflow-wrap:break-word}
a{color:#1d4ed8;text-decoration:underline}
img{height:auto;max-width:100%}
img[data-blocked]{display:inline-block;min-width:24px;min-height:24px;border:1px dashed #d4d4d4;border-radius:4px;background:#f5f5f5}
table{max-width:100%}
`

/** Builds the srcdoc document for the sandboxed mail iframe (body is already sanitized). */
export function buildMailSrcdoc(bodyHtml: string, remoteAllowed: boolean): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${mailFrameCsp(remoteAllowed)}">` +
    `<style>${FRAME_CSS}</style></head><body>${bodyHtml}</body></html>`
  )
}

/**
 * DOMPurify ALLOWED_URI_REGEXP for mail HTML. Keeps the default's non-URI branch
 * ([^a-z] | word without colon): values that are not URIs at all (width="1") stay
 * allowed — otherwise isTrackingPixel never sees them (vuln-0003). Only scheme
 * checks get stricter.
 */
export const MAIL_URI_REGEXP =
  /^(?:(?:https?:|mailto:|cid:|data:image\/)|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i

/** Tiny or hidden images (1x1, ≤2px, display:none) are tracking pixels. */
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
