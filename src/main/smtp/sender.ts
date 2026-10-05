import nodemailer from 'nodemailer'
import type Database from 'better-sqlite3-multiple-ciphers'
import { getSecret } from '../auth/secrets'
import { getSetting } from '../db'
import { accountSecretKey, isLoopbackHost, type AccountRow } from '../auth/providers'
import { detectImplicitTls, forgetTlsMode } from './tls-mode'
import { msAccessToken } from '../auth/msal'
import { googleAccessToken } from '../auth/google'
import {
  appendSignatureText,
  fitSignatureImage,
  signatureImageBackground,
  type SignatureImageShape
} from '@shared/signature'
import { renderSignatureImage } from './signature-image'

export interface OutgoingMail {
  accountId: number
  to: string[]
  cc: string[]
  bcc?: string[]
  subject: string
  textBody: string
  htmlBody?: string
  replyToMessageId?: number
}

interface StoredSignature {
  blocks?: string[]
  values?: Record<string, string>
  img?: boolean
  imgData?: string
  imgShape?: SignatureImageShape
  imgPos?: 'left' | 'top' | 'bottom'
  imgWidth?: number
  imgHeight?: number
  imgBorder?: boolean
  imgPadding?: number
  imgBackground?: string | null
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function signatureText(sig: StoredSignature): string {
  return (sig.blocks ?? [])
    .map((key) => (key === 'rule' ? '—' : (sig.values?.[key] ?? '').trim()))
    .filter(Boolean)
    .join('\n')
}

function signatureBlocksHtml(sig: StoredSignature): string {
  return (sig.blocks ?? [])
    .map((key) => {
      if (key === 'rule') return '<div style="width:220px;max-width:100%;border-top:1px solid #17150f;margin:7px 0"></div>'
      const value = escapeHtml((sig.values?.[key] ?? '').trim())
      if (!value) return ''
      if (key === 'name') return `<div style="font-weight:600;font-size:14px;color:#17150f">${value}</div>`
      if (key === 'title' || key === 'claim') {
        return `<div style="font-style:italic;font-size:12px;color:#57503f;margin-top:3px">${value}</div>`
      }
      if (key === 'studio') {
        return `<div style="font-weight:600;font-size:11px;letter-spacing:1px;color:#17150f;margin-top:3px">${value}</div>`
      }
      return `<div style="font-size:11px;color:#6e6759;margin-top:3px">${value}</div>`
    })
    .join('')
}

function safeBodyHtml(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed|form)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1#$2')
}

/**
 * Versendet über den SMTP-Server des Kontos. Threading-Header (In-Reply-To,
 * References) werden aus der beantworteten Nachricht abgeleitet — so landet
 * die Antwort beim Empfänger im richtigen Thread. Gmail/Outlook/Bridge legen
 * die Mail serverseitig selbst im Sent-Ordner ab (kein APPEND nötig).
 */
export async function sendMail(db: Database.Database, mail: OutgoingMail): Promise<void> {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(mail.accountId) as
    | AccountRow
    | undefined
  if (!account) throw new Error('Konto nicht gefunden')

  let auth: { user: string; pass: string } | { type: 'OAuth2'; user: string; accessToken: string }
  if (account.credential_type === 'oauth-ms') {
    auth = {
      type: 'OAuth2',
      user: account.email,
      accessToken: await msAccessToken(account.email)
    }
  } else if (account.credential_type === 'oauth-google') {
    auth = {
      type: 'OAuth2',
      user: account.email,
      accessToken: await googleAccessToken(account.email)
    }
  } else {
    const password = getSecret(accountSecretKey(account.id))
    if (!password) throw new Error('Kein Passwort im Vault für dieses Konto')
    auth = { user: account.email, pass: password }
  }

  let inReplyTo: string | undefined
  let references: string | undefined
  if (mail.replyToMessageId) {
    const original = db
      .prepare('SELECT message_id, refs FROM messages WHERE id = ?')
      .get(mail.replyToMessageId) as { message_id: string | null; refs: string | null } | undefined
    if (original?.message_id) {
      inReplyTo = original.message_id
      references = [original.refs, original.message_id].filter(Boolean).join(' ')
    }
  }

  // Öffentliche Server: Betriebsart folgt der Port-Konvention (465 = SSL,
  // 587 = STARTTLS). Auf Loopback (Proton Bridge) ist sie konfigurierbar und
  // wird deshalb am Server erkannt statt geraten.
  const loopback = isLoopbackHost(account.smtp_host)
  const implicitTls = loopback
    ? await detectImplicitTls(account.smtp_host, account.smtp_port)
    : account.smtp_port === 465
  const transport = nodemailer.createTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: implicitTls,
    // Port 587 (Outlook.com) verlangt STARTTLS
    requireTLS: !loopback && account.smtp_port === 587,
    auth,
    // Loopback (Proton Bridge): selbstsigniertes Zertifikat akzeptieren
    ...(loopback ? { tls: { rejectUnauthorized: false } } : {})
  })

  try {
    // Formatierter Composer und Signatur-Baukasten erzeugen eine HTML-Alternative;
    // der Text bleibt für reine Text-Clients vollständig erhalten.
    let html: string | undefined
    let attachments: Array<{ cid: string; filename: string; content: Buffer }> | undefined
    let plainText = mail.textBody
    try {
      const raw = getSetting(`sig.${mail.accountId}`)
      const sig = raw ? (JSON.parse(raw) as StoredSignature) : null
      const plainSignature = sig ? signatureText(sig) : (account.signature?.trim() ?? '')
      plainText = appendSignatureText(mail.textBody, plainSignature)
      const bodyText =
        plainSignature && plainText.trimEnd().endsWith(plainSignature)
          ? plainText.trimEnd().slice(0, -plainSignature.length).trimEnd()
          : plainText
      const bodyHtml = mail.htmlBody?.trim()
        ? safeBodyHtml(mail.htmlBody)
        : `<div style="white-space:pre-wrap">${escapeHtml(bodyText)}</div>`

      let imageHtml = ''
      let layout: ReturnType<typeof fitSignatureImage> | null = null
      if (sig?.img && sig.imgData?.startsWith('data:image/')) {
        const [, b64] = sig.imgData.split(',')
        const radius = sig.imgShape === 'circle' ? '50%' : sig.imgShape === 'rounded' ? '10px' : '0'
        layout = fitSignatureImage(sig.imgWidth, sig.imgHeight, sig.imgShape, sig.imgPadding)
        const source = Buffer.from(b64, 'base64')
        const background = signatureImageBackground(sig.imgBackground)
        attachments = [{
          cid: 'noctua-sig',
          filename: 'signatur.png',
          content: await renderSignatureImage(source, layout, sig.imgShape, background)
        }]
        const border = sig.imgBorder === false ? 'none' : '1px solid #17150f'
        imageHtml = `<img src="cid:noctua-sig" width="${layout.width}" height="${layout.height}" style="display:block!important;box-sizing:border-box!important;width:${layout.width}px!important;height:${layout.height}px!important;max-width:${layout.width}px!important;max-height:${layout.height}px!important;padding:0!important;border:${border};border-radius:${radius};object-fit:contain;background:transparent!important" alt="">`
      }

      const blocks = sig ? signatureBlocksHtml(sig) : plainSignature
        ? `<div style="white-space:pre-wrap">${escapeHtml(plainSignature)}</div>`
        : ''
      let signatureHtml = ''
      if (blocks || imageHtml) {
        if (!imageHtml) signatureHtml = `<div style="margin-top:14px">${blocks}</div>`
        else if (sig?.imgPos === 'top') {
          signatureHtml = `<div style="margin-top:14px">${imageHtml}<div style="margin-top:10px">${blocks}</div></div>`
        } else if (sig?.imgPos === 'bottom') {
          signatureHtml = `<div style="margin-top:14px">${blocks}<div style="margin-top:10px">${imageHtml}</div></div>`
        } else {
          signatureHtml = `<table role="presentation" cellspacing="0" cellpadding="0" style="margin-top:14px;border-collapse:collapse"><tr><td width="${layout?.width ?? 180}" valign="top" style="width:${layout?.width ?? 180}px;max-width:${layout?.width ?? 180}px;padding-right:14px">${imageHtml}</td><td valign="top">${blocks}</td></tr></table>`
        }
      }
      if (mail.htmlBody?.trim() || signatureHtml || imageHtml) {
        html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#17150f">${bodyHtml}${signatureHtml}</div>`
      }
    } catch {
      html = undefined
      attachments = undefined
      plainText = appendSignatureText(mail.textBody, account.signature?.trim() ?? '')
    }

    await transport.sendMail({
      from: account.display_name
        ? { name: account.display_name, address: account.email }
        : account.email,
      to: mail.to,
      cc: mail.cc.length > 0 ? mail.cc : undefined,
      bcc: mail.bcc && mail.bcc.length > 0 ? mail.bcc : undefined,
      subject: mail.subject,
      text: plainText,
      ...(html ? { html, attachments } : {}),
      inReplyTo,
      references
    })
  } catch (error) {
    // Falsch erkannte Betriebsart (z. B. Bridge umkonfiguriert)? Beim
    // nächsten Versuch neu erkennen statt am Cache festzuhalten.
    if (loopback) forgetTlsMode(account.smtp_host, account.smtp_port)
    throw error
  } finally {
    transport.close()
  }
}
