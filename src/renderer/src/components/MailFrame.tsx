import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify, { type Config } from 'dompurify'
import { invoke } from '@renderer/lib/ipc'
import { t, useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { linkHostMismatch } from '@shared/link-check'
import { buildMailSrcdoc, isTrackingPixel, sanitizeInlineStyle } from '@renderer/lib/mail-sanitize'

/**
 * Renders mail HTML after strict sanitizing. Lines of defense:
 * DOMPurify (tags/attributes/URIs, inline styles without url()/fixed) + image transform
 * (remote images are parked instead of loaded, tracking pixels removed) +
 * sandboxed iframe with its own CSP (no network without approval, no overlay on top
 * of the app UI) + app CSP + sandboxed renderer. Links go exclusively through
 * the main process to the system browser.
 */
const PURIFY_CONFIG: Config = {
  FORBID_TAGS: [
    'style',
    'form',
    'input',
    'button',
    'iframe',
    'object',
    'embed',
    'svg',
    'math',
    'link',
    'meta',
    'base',
    'video',
    'audio'
  ],
  FORBID_ATTR: ['srcset', 'formaction', 'background', 'poster'],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|cid:|data:image\/)/i
}

// Inline styles must not trigger network requests or lay anything over the UI
DOMPurify.addHook('uponSanitizeAttribute', (_node, data) => {
  if (data.attrName !== 'style') return
  const style = sanitizeInlineStyle(data.attrValue)
  if (style) data.attrValue = style
  else data.keepAttr = false
})

function transformImages(
  cleanHtml: string,
  inlineImages: Record<string, string>,
  remoteAllowed: boolean
): { html: string; blockedCount: number } {
  const doc = new DOMParser().parseFromString(cleanHtml, 'text/html')
  let blockedCount = 0
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src') ?? ''
    if (src.startsWith('cid:')) {
      const dataUri = inlineImages[src.slice(4)]
      if (dataUri) img.setAttribute('src', dataUri)
      else img.removeAttribute('src')
    } else if (/^https?:/i.test(src)) {
      // Tracking pixels are removed even when remote images are allowed (the
      // approval hinges on the spoofable From address) and do not count as blocked.
      if (
        isTrackingPixel({
          width: img.getAttribute('width'),
          height: img.getAttribute('height'),
          style: img.getAttribute('style')
        })
      ) {
        img.remove()
      } else if (!remoteAllowed) {
        img.removeAttribute('src')
        img.setAttribute('data-blocked', '1')
        blockedCount++
      }
    }
  })
  return { html: doc.body.innerHTML, blockedCount }
}

/**
 * Opens a link via the main process. If the link text looks like a URL
 * and the href leads to a different host (phishing pattern), a confirmation
 * toast comes first.
 */
function openAnchor(anchor: HTMLAnchorElement): void {
  const href = anchor.getAttribute('href')
  if (!href) return
  const open = (): void => void invoke('app:openExternal', { url: href })
  const mismatch = linkHostMismatch(anchor.textContent ?? '', href)
  if (!mismatch) return open()
  toast.info(t('linkMismatchWarn', mismatch), {
    dismiss: true,
    action: { label: t('linkMismatchOpen'), run: open }
  })
}

function openLink(event: React.MouseEvent): void {
  const anchor = (event.target as HTMLElement).closest('a')
  if (anchor) {
    event.preventDefault()
    openAnchor(anchor)
  }
}

/** Mail HTML in a sandboxed iframe: own document, own CSP, no access to the app UI. */
function SandboxedMail({
  body,
  remoteAllowed
}: {
  body: string
  remoteAllowed: boolean
}): React.JSX.Element {
  const [height, setHeight] = useState(120)
  const observer = useRef<ResizeObserver | null>(null)
  const srcDoc = useMemo(() => buildMailSrcdoc(body, remoteAllowed), [body, remoteAllowed])

  useEffect(() => () => observer.current?.disconnect(), [])

  // Sandbox: deliberately WITHOUT allow-scripts (and without popups/forms/navigation).
  // allow-same-origin is only set so the parent window can measure height and catch clicks;
  // without scripts (plus CSP default-src 'none') the frame content cannot use this bridge.
  const onLoad = (event: React.SyntheticEvent<HTMLIFrameElement>): void => {
    const doc = event.currentTarget.contentDocument
    if (!doc?.body) return
    observer.current?.disconnect()
    const measure = (): void => setHeight(Math.ceil(doc.body.getBoundingClientRect().height))
    measure()
    observer.current = new ResizeObserver(measure)
    observer.current.observe(doc.body)
    doc.addEventListener('click', (e) => {
      const anchor = (e.target as Element | null)?.closest('a')
      if (anchor) {
        e.preventDefault()
        openAnchor(anchor)
      }
    })
  }

  return (
    <iframe
      title="mail"
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      onLoad={onLoad}
      scrolling="no"
      className="mail-html block w-full select-text rounded-lg shadow-[inset_0_0_0_1px_var(--border)]"
      // Mail clients limit bodies to ~640-700px — otherwise newsletter
      // images grow to sheet width and look huge.
      style={{ maxWidth: 680, margin: '0 auto', height, border: 0 }}
    />
  )
}

export function MailFrame({
  html,
  fromAddr,
  inlineImages,
  remoteImagesAllowed
}: {
  html: string
  fromAddr: string | null
  inlineImages: Record<string, string>
  remoteImagesAllowed: boolean
}): React.JSX.Element {
  const t = useT()
  const [showRemote, setShowRemote] = useState(false)
  const [allowedPermanently, setAllowedPermanently] = useState(false)
  const remoteAllowed = remoteImagesAllowed || showRemote || allowedPermanently

  const { html: rendered, blockedCount } = useMemo(() => {
    const clean = String(DOMPurify.sanitize(html, PURIFY_CONFIG))
    return transformImages(clean, inlineImages, remoteAllowed)
  }, [html, inlineImages, remoteAllowed])

  const allowSenderPermanently = async (): Promise<void> => {
    if (fromAddr) {
      await invoke('images:allowSender', { addr: fromAddr, allow: true })
      setAllowedPermanently(true)
    }
  }

  return (
    <div>
      {blockedCount > 0 && (
        <div className="anim-rise mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11.5px] text-text-faint">
          <span>
            {blockedCount === 1
              ? t('remoteImagesBlockedOne')
              : t('remoteImagesBlocked', { n: blockedCount })}
          </span>
          <button
            onClick={() => setShowRemote(true)}
            className="rounded border border-border px-1.5 py-0.5 text-text-muted hover:bg-surface-3"
          >
            {t('remoteImagesShow')}
          </button>
          {fromAddr && (
            <button
              onClick={() => void allowSenderPermanently()}
              className="rounded border border-border px-1.5 py-0.5 text-text-muted hover:bg-surface-3"
            >
              {t('remoteImagesAllowSender', { addr: fromAddr })}
            </button>
          )}
        </div>
      )}
      <SandboxedMail body={rendered} remoteAllowed={remoteAllowed} />
    </div>
  )
}

export function PlainTextBody({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(https?:\/\/[^\s<>"]+)/g)
  return (
    <div
      className="select-text whitespace-pre-wrap px-1 py-2 text-[14px] leading-relaxed text-text"
      onClick={openLink}
    >
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} className="text-accent underline">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </div>
  )
}
