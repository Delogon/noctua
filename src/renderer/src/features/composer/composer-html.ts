import DOMPurify from 'dompurify'
import { textToComposerHtml } from './composer-state'

export function sanitizeComposerHtml(html: string): string {
  return String(
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['div', 'p', 'br', 'b', 'strong', 'i', 'em', 'u', 'a', 'span', 'font'],
      ALLOWED_ATTR: ['href', 'target', 'rel', 'size', 'style']
    })
  )
}

/**
 * HTML alternative for sending. If real editor HTML is missing (or it is only
 * raw text without line tags), the plain text is converted into <div> blocks —
 * otherwise the line breaks collapse in HTML clients and the Sent view.
 */
export function composerHtmlForSend(html: string, text: string): string {
  const trimmed = html.trim()
  const hasLineStructure = /<(div|p|br)\b/i.test(trimmed)
  return sanitizeComposerHtml(hasLineStructure ? html : textToComposerHtml(text))
}
