import { useEffect, useMemo, useRef, useState } from 'react'
import DOMPurify, { type Config } from 'dompurify'
import { invoke } from '@renderer/lib/ipc'
import { t, useT } from '@renderer/lib/i18n'
import { toast } from '@renderer/stores/toast'
import { linkHostMismatch } from '@shared/link-check'
import { buildMailSrcdoc, isTrackingPixel, sanitizeInlineStyle } from '@renderer/lib/mail-sanitize'

/**
 * Rendert Mail-HTML nach hartem Sanitizing. Verteidigungslinien:
 * DOMPurify (Tags/Attribute/URIs, Inline-Styles ohne url()/fixed) + Bild-Transform
 * (Remote-Bilder werden geparkt statt geladen, Tracking-Pixel entfernt) +
 * sandboxed iframe mit eigener CSP (kein Netz ohne Freigabe, kein Overlay über
 * der App-UI) + App-CSP + sandboxed Renderer. Links gehen ausschließlich über
 * den Main-Prozess in den System-Browser.
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

// Inline-Styles dürfen keine Netz-Requests auslösen und nichts über die UI legen
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
      // Tracking-Pixel fliegen auch bei erlaubten Remote-Bildern raus (die
      // Freigabe hängt an der fälschbaren From-Adresse) und zählen nicht als blockiert.
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
 * Öffnet einen Link über den Main-Prozess. Sieht der Linktext wie eine URL aus
 * und führt der href zu einem anderen Host (Phishing-Muster), kommt vorher eine
 * Rückfrage als Toast.
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

/** Mail-HTML in sandboxed iframe: eigenes Dokument, eigene CSP, kein Zugriff auf die App-UI. */
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

  // Sandbox: bewusst OHNE allow-scripts (und ohne Popups/Forms/Navigation). allow-same-origin
  // ist nur gesetzt, damit das Elternfenster Höhe messen und Klicks abfangen kann; ohne
  // Scripts (plus CSP default-src 'none') kann der Frame-Inhalt diese Brücke nicht nutzen.
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
      // Mail-Clients begrenzen Bodys auf ~640-700px — sonst wachsen
      // Newsletter-Bilder auf Sheet-Breite und wirken riesig.
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
