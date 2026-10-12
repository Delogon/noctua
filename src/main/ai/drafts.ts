import { randomUUID } from 'node:crypto'
import { currentDateLine, localStamp } from './prompt-date'
import type Database from 'better-sqlite3-multiple-ciphers'
import type { PushChannel, PushPayload } from '@shared/ipc-contract'
import { htmlToText } from '../mail/parser'
import { requireTaskWithBudget } from './providers/registry'
import { logUsage } from './budget'
import {
  detectAddressForm,
  extractContactStyle,
  getStyleProfile,
  refreshStyleProfile,
  stripQuoted
} from './style'
import { getSetting } from '../db'
import { buildAvailabilityBlock } from './availability'
import {
  UNTRUSTED_SYSTEM_NOTE,
  sanitizeUntrusted,
  sanitizeUntrustedLine,
  wrapUntrusted
} from './untrusted'
import {
  renderSignatureText,
  stripRedundantSignatureTail,
  type SignatureConfig
} from '@shared/signature'
import { outputLanguage } from './output-language'

type PushFn = <C extends PushChannel>(channel: C, payload: PushPayload<C>) => void

interface ThreadMessageRow {
  id: number
  account_id: number
  from_name: string | null
  from_addr: string | null
  subject: string | null
  date: number | null
  text_plain: string | null
  html_raw: string | null
}

function bodyText(row: { text_plain: string | null; html_raw: string | null }): string {
  return (row.text_plain?.trim() || htmlToText(row.html_raw ?? '')).slice(0, 1500)
}

/** 3 Stilbeispiele aus dem Sent-Ordner: bevorzugt an dieselbe Gegenstelle. */
function styleExamples(
  db: Database.Database,
  accountId: number,
  counterpart: string | null
): string[] {
  const base = `SELECT b.text_plain FROM messages m
    JOIN folders f ON f.id = m.folder_id
    JOIN message_bodies b ON b.message_id = m.id
    WHERE m.account_id = ? AND f.special_use = '\\Sent' AND b.text_plain IS NOT NULL AND length(b.text_plain) > 40`
  const preferred = counterpart
    ? (db
        .prepare(`${base} AND m.to_json LIKE ? ORDER BY m.date DESC LIMIT 3`)
        .all(accountId, `%${counterpart}%`) as Array<{ text_plain: string }>)
    : []
  const rest =
    preferred.length < 3
      ? (db
          .prepare(`${base} ORDER BY m.date DESC LIMIT ?`)
          .all(accountId, 3 - preferred.length) as Array<{ text_plain: string }>)
      : []
  return [...preferred, ...rest].map((r) => r.text_plain.slice(0, 800))
}

/**
 * Du/Sie aus dem konkreten Verlauf mit der Person — hat VORRANG vor dem
 * gelernten Postfach-Profil. Prio: eigene frühere Mails an den Kontakt,
 * dann dessen Mails an den Nutzer; ohne Signal entscheidet das Profil.
 */
function formalityBlock(
  db: Database.Database,
  accountId: number,
  accountEmail: string,
  contactAddr: string | null,
  threadMessages: Array<{
    from_addr: string | null
    text_plain: string | null
    html_raw: string | null
  }>
): string {
  const ownInThread = threadMessages
    .filter((m) => m.from_addr === accountEmail)
    .map((m) => stripQuoted(bodyText(m as ThreadMessageRow)))
  const ownSent = contactAddr
    ? (
        db
          .prepare(
            `SELECT b.text_plain FROM messages m
             JOIN folders f ON f.id = m.folder_id
             JOIN message_bodies b ON b.message_id = m.id
             WHERE m.account_id = ? AND f.special_use = '\\Sent'
               AND m.to_json LIKE ? AND b.text_plain IS NOT NULL
             ORDER BY m.date DESC LIMIT 5`
          )
          .all(accountId, `%${contactAddr.toLowerCase()}%`) as Array<{ text_plain: string }>
      ).map((r) => stripQuoted(r.text_plain))
    : []
  const foreign = threadMessages
    .filter((m) => m.from_addr !== accountEmail)
    .map((m) => stripQuoted(bodyText(m as ThreadMessageRow)))
  const form = detectAddressForm([...ownInThread, ...ownSent]) ?? detectAddressForm(foreign)
  if (!form) return ''
  return `\n\nADDRESS RULE (takes PRIORITY over the style profile and all other instructions): in the conversation with this contact, ${
    form === 'sie'
      ? 'the formal "Sie" applies — consistently use the formal address (Sie/Ihnen/Ihre), never "du"'
      : 'the informal "du" applies — consistently use "du", never the formal "Sie"'
  }.`
}

/** Harte Schreibregeln für ALLE Entwürfe (Tims Vorgabe, M30). */
const BASE_STYLE_RULES =
  '- No bullet points or list markers, no dashes (– or —) and no semicolons: write in complete sentences and normal paragraphs.'

/**
 * Manuelle Stil-Anweisungen (haben Vorrang vor dem gelernten Profil):
 * global (ai.styleInstructions) plus adressspezifisch (ai.styleInstructions.<id>).
 */
function styleInstructionsBlock(accountId?: number | null): string {
  const parts = [
    getSetting('ai.styleInstructions')?.trim(),
    accountId ? getSetting(`ai.styleInstructions.${accountId}`)?.trim() : null
  ].filter((x): x is string => !!x)
  if (parts.length === 0) return ''
  return `\n\nStyle instructions set by the user (take PRIORITY over everything else):\n${parts.join('\n')}`
}

function signatureState(
  accountId: number,
  legacySignature: string | null
): { configured: boolean; reference: string } {
  const rawSignatureConfig = getSetting(`sig.${accountId}`)
  let reference = legacySignature?.trim() ?? ''
  let configured = reference.length > 0
  if (!rawSignatureConfig) return { configured, reference }
  try {
    const config = JSON.parse(rawSignatureConfig) as SignatureConfig
    const rendered = renderSignatureText(config)
    configured = Boolean(config.img || rendered.trim())
    reference = [config.values?.name, rendered]
      .filter((value): value is string => !!value?.trim())
      .join('\n')
  } catch {
    // Ungueltige Alt-Konfiguration: klassische Kontosignatur verwenden.
  }
  return { configured, reference }
}

/**
 * Streamt einen Antwortentwurf (Opus) in den Composer. Chunks gehen als
 * ai:draftChunk-Events raus; der Entwurf ist immer editierbar, gesendet wird
 * ausschließlich manuell.
 */
export function startDraftReply(
  db: Database.Database,
  push: PushFn,
  input: { threadKey: string; instruction?: string; idea?: string; reviseText?: string }
): { draftId: string } {
  const draftId = randomUUID()
  void runDraft(db, push, draftId, input).catch((error) => {
    push('ai:draftChunk', {
      draftId,
      chunk: '',
      done: true,
      error: error instanceof Error ? error.message : String(error),
      subject: null
    })
  })
  return { draftId }
}

async function runDraft(
  db: Database.Database,
  push: PushFn,
  draftId: string,
  input: { threadKey: string; instruction?: string; idea?: string; reviseText?: string }
): Promise<void> {
  const { client, model } = requireTaskWithBudget(
    db,
    'draft',
    'KI-Budget aufgebraucht – Entwurf nicht gestartet'
  )

  const messages = db
    .prepare(
      `SELECT m.id, m.account_id, m.from_name, m.from_addr, m.subject, m.date,
              b.text_plain, b.html_raw
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.thread_key = ?
       ORDER BY coalesce(m.date, m.internal_date, 0) DESC LIMIT 10`
    )
    .all(input.threadKey) as ThreadMessageRow[]
  if (messages.length === 0) throw new Error('Unterhaltung nicht gefunden')

  const accountId = messages[0].account_id
  const account = db
    .prepare('SELECT email, display_name, signature FROM accounts WHERE id = ?')
    .get(accountId) as { email: string; display_name: string | null; signature: string | null }
  const replySignature = signatureState(accountId, account.signature)
  const lastForeign = messages.find((m) => m.from_addr !== account.email) ?? messages[0]
  const examples = styleExamples(db, accountId, lastForeign.from_addr)

  // Stil-Profil: einmalig lernen, danach aus den Settings; plus die konkrete
  // Anrede/Grußformel, die der Nutzer bei genau diesem Kontakt verwendet.
  let profile = getStyleProfile(accountId)
  if (!profile) {
    try {
      profile = await refreshStyleProfile(db, accountId)
    } catch (error) {
      console.warn('[drafts] Stil-Profil konnte nicht gelernt werden:', error)
    }
  }
  const contactStyle = extractContactStyle(db, accountId, lastForeign.from_addr)
  const formality = formalityBlock(db, accountId, account.email, lastForeign.from_addr, messages)

  // SEC-15: Mail-Inhalt ist unvertrauenswürdig — bereinigt und in Delimitern
  const threadContext = wrapUntrusted(
    'THREAD',
    [...messages]
      .reverse()
      .map(
        (m) =>
          `--- ${sanitizeUntrustedLine(m.from_name ?? m.from_addr ?? '?', 120)} (${m.date ? localStamp(m.date) : '?'}) ---\n${sanitizeUntrusted(bodyText(m), 1500)}`
      )
      .join('\n\n')
  )

  // Verfügbarkeit (opt-out über ai.draftUseCalendar): nur wenn die Mail nach einem Termin fragt
  const availability = buildAvailabilityBlock(db, {
    now: Date.now(),
    lastMessageText: stripQuoted(bodyText(lastForeign)),
    hasEventSuggestion: !!db
      .prepare(
        `SELECT 1 FROM event_suggestions WHERE thread_key = ? AND state != 'dismissed' LIMIT 1`
      )
      .get(input.threadKey)
  })

  const profileBlock = profile
    ? `\n\nThe user's writing style profile (learned from sent emails):
- Languages: ${profile.languages.join(', ') || 'unknown'}
- Informal/formal address (du/Sie): ${profile.formality || 'unknown'}
- Typical salutations: ${profile.greetings.join(' | ') || '—'}
- Typical sign-offs: ${replySignature.configured ? 'covered by the separate signature and NOT written into the reply text' : profile.closings.join(' | ') || '—'}
- Traits: ${profile.style_notes.join('; ') || '—'}`
    : ''
  const contactBlock =
    contactStyle.salutation || (!replySignature.configured && contactStyle.closing)
      ? `\n\nWith EXACTLY THIS contact the user usually writes:${
          contactStyle.salutation ? `\n- Salutation: "${contactStyle.salutation}"` : ''
        }${!replySignature.configured && contactStyle.closing ? `\n- Sign-off: "${contactStyle.closing}"` : ''}
Use exactly this register.`
      : ''

  const systemPrompt = `${currentDateLine()}
You draft email replies for ${account.display_name ?? account.email} <${account.email}>.
${UNTRUSTED_SYSTEM_NOTE}
Rules:
- Reply in the language of the last incoming message.
- Match the user's tone: the style profile and contact register below are authoritative,
  the style examples show it in action.
- Output ONLY the email text: no subject line, no explanations, no placeholders such as [Name].
${
  replySignature.configured
    ? '- A separate signature is set up for this mailbox. End right after the last sentence of content. Write NO sign-off, NO name and NO signature, title, organisation or contact line.'
    : "- End with the user's sign-off and at most their first name."
}
- Be concrete and brief, and do not invent facts that are not in the thread.
${BASE_STYLE_RULES}${profileBlock}${contactBlock}${formality}${styleInstructionsBlock(accountId)}${availability ?? ''}${
    examples.length > 0
      ? `\n\nStyle examples from the user (earlier sent emails):\n\n${examples.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n')}`
      : ''
  }`

  const userPrompt = `Conversation (oldest first):\n\n${threadContext}\n\nWrite a reply to the last message from ${sanitizeUntrustedLine(lastForeign.from_name ?? lastForeign.from_addr, 120)}.${
    input.instruction ? `\nInstruction from the user: ${input.instruction}` : ''
  }${
    input.reviseText?.trim() && input.idea?.trim()
      ? `\nThe user already has this draft:\n---DRAFT---\n${input.reviseText.trim()}\n---END DRAFT---\nApply the following change requests to the draft and output the complete revised reply. Everything the requests do not affect stays word for word:\n${input.idea.trim()}`
      : input.idea?.trim()
        ? `\nThe user provided these bullet points/this dictation as the basis — turn it into the reply:\n${input.idea.trim()}`
        : ''
  }`

  let signatureSafeBuffer = ''
  const { usage } = await client.stream(
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      maxTokens: 1500
    },
    (delta) => {
      if (replySignature.configured) signatureSafeBuffer += delta
      else push('ai:draftChunk', { draftId, chunk: delta, done: false, error: null, subject: null })
    }
  )
  // Der Adapter schätzt die Usage selbst, falls der Stream keine liefert
  logUsage(db, model, usage.inputTokens, usage.outputTokens, usage.costUsd)
  if (replySignature.configured) {
    const safeText = stripRedundantSignatureTail(signatureSafeBuffer, replySignature.reference)
    if (safeText) {
      push('ai:draftChunk', {
        draftId,
        chunk: safeText,
        done: false,
        error: null,
        subject: null
      })
    }
  }
  push('ai:draftChunk', { draftId, chunk: '', done: true, error: null, subject: null })
}

interface ParsedChunk {
  subject: string | null
  text: string
}

interface ParsedCompositionMode {
  mode: 'dictation' | 'idea' | null
  text: string
}

/**
 * Entfernt das interne `MODUS: DIKTAT|IDEE` am Stream-Anfang und reicht den
 * eigentlichen Ausgabe-Stream weiter. Fehlt das Protokoll, geht kein Text
 * verloren.
 */
export function createCompositionModeParser(): {
  feed: (delta: string) => ParsedCompositionMode
  flush: () => ParsedCompositionMode
} {
  const HEADER = 'MODE:'
  let state: 'detect' | 'mode' | 'pass' = 'detect'
  let buffer = ''

  const step = (): ParsedCompositionMode => {
    if (state === 'detect') {
      if (HEADER.startsWith(buffer)) {
        if (buffer.length < HEADER.length) return { mode: null, text: '' }
        state = 'mode'
      } else if (buffer.startsWith(HEADER)) {
        state = 'mode'
      } else {
        state = 'pass'
        const text = buffer
        buffer = ''
        return { mode: null, text }
      }
    }
    if (state === 'mode') {
      const newline = buffer.indexOf('\n')
      if (newline === -1) return { mode: null, text: '' }
      const rawMode = buffer.slice(HEADER.length, newline).trim().toUpperCase()
      const text = buffer.slice(newline + 1)
      buffer = ''
      state = 'pass'
      return {
        mode: rawMode === 'DICTATION' ? 'dictation' : rawMode === 'IDEA' ? 'idea' : null,
        text
      }
    }
    const text = buffer
    buffer = ''
    return { mode: null, text }
  }

  return {
    feed(delta: string): ParsedCompositionMode {
      if (state === 'pass') return { mode: null, text: delta }
      buffer += delta
      return step()
    },
    flush(): ParsedCompositionMode {
      if (state === 'mode') {
        const rawMode = buffer.slice(HEADER.length).trim().toUpperCase()
        buffer = ''
        state = 'pass'
        return {
          mode: rawMode === 'DICTATION' ? 'dictation' : rawMode === 'IDEA' ? 'idea' : null,
          text: ''
        }
      }
      const text = buffer
      buffer = ''
      state = 'pass'
      return { mode: null, text }
    }
  }
}

/**
 * Streaming-Parser für das BETREFF-Protokoll neuer Mails: Das Modell darf als
 * erste Zeile `BETREFF: <Vorschlag>` gefolgt von einer `---`-Zeile liefern;
 * beides wird abgefangen, der Rest fließt als normaler Text durch. Beginnt der
 * Stream anders, wird alles unverändert durchgereicht.
 */
export function createSubjectProtocolParser(): {
  feed: (delta: string) => ParsedChunk
  flush: () => ParsedChunk
} {
  const HEADER = 'SUBJECT:'
  let state: 'detect' | 'subject' | 'separator' | 'pass' = 'detect'
  let buf = ''

  const step = (): ParsedChunk => {
    let subject: string | null = null
    if (state === 'detect') {
      if (HEADER.startsWith(buf)) {
        if (buf.length < HEADER.length) return { subject: null, text: '' }
        state = 'subject'
        buf = ''
      } else if (buf.startsWith(HEADER)) {
        state = 'subject'
        buf = buf.slice(HEADER.length)
      } else {
        state = 'pass'
        const text = buf
        buf = ''
        return { subject: null, text }
      }
    }
    if (state === 'subject') {
      const nl = buf.indexOf('\n')
      if (nl === -1) return { subject: null, text: '' }
      subject = buf.slice(0, nl).trim() || null
      buf = buf.slice(nl + 1)
      state = 'separator'
    }
    if (state === 'separator') {
      const nl = buf.indexOf('\n')
      if (nl === -1) {
        if (buf !== '' && !/^-+$/.test(buf)) {
          // kann keine Trennlinie mehr werden → Text
          state = 'pass'
          const text = buf
          buf = ''
          return { subject, text }
        }
        return { subject, text: '' }
      }
      const line = buf.slice(0, nl)
      const rest = buf.slice(nl + 1)
      buf = ''
      state = 'pass'
      return { subject, text: /^-{3,}\s*$/.test(line) ? rest : `${line}\n${rest}` }
    }
    const text = buf
    buf = ''
    return { subject, text }
  }

  return {
    feed(delta: string): ParsedChunk {
      if (state === 'pass') return { subject: null, text: delta }
      buf += delta
      return step()
    },
    flush(): ParsedChunk {
      if (state === 'subject') {
        // Stream endete in der Betreffzeile — als Betreff werten
        const subject = buf.trim() || null
        buf = ''
        state = 'pass'
        return { subject, text: '' }
      }
      const text = buf
      buf = ''
      state = 'pass'
      return { subject: null, text }
    }
  }
}

/**
 * Streamt einen kurzen Nachfass-„Stups" für eine unbeantwortete gesendete
 * Mail (Waiting-View). Höflich, ohne Druck, im Stil des sendenden Kontos.
 * Mit `idea` formuliert die Eule den vom Nutzer bearbeiteten/diktierten
 * Stups neu (⌘J im Stups-Composer).
 */
export function startDraftNudge(
  db: Database.Database,
  push: PushFn,
  input: { messageId: number; idea?: string }
): { draftId: string } {
  const draftId = randomUUID()
  void runDraftNudge(db, push, draftId, input).catch((error) => {
    push('ai:draftChunk', {
      draftId,
      chunk: '',
      done: true,
      error: error instanceof Error ? error.message : String(error),
      subject: null
    })
  })
  return { draftId }
}

async function runDraftNudge(
  db: Database.Database,
  push: PushFn,
  draftId: string,
  input: { messageId: number; idea?: string }
): Promise<void> {
  const { client, model } = requireTaskWithBudget(db, 'draft')

  const sent = db
    .prepare(
      `SELECT m.account_id, m.subject, m.to_json, m.date, b.text_plain
       FROM messages m LEFT JOIN message_bodies b ON b.message_id = m.id
       WHERE m.id = ?`
    )
    .get(input.messageId) as
    | {
        account_id: number
        subject: string | null
        to_json: string
        date: number | null
        text_plain: string | null
      }
    | undefined
  if (!sent) throw new Error('Gesendete E-Mail nicht gefunden')

  const account = db
    .prepare('SELECT email, display_name, signature FROM accounts WHERE id = ?')
    .get(sent.account_id) as {
    email: string
    display_name: string | null
    signature: string | null
  }
  // Signatur-Verhalten exakt wie beim Antwortentwurf: ist eine Signatur
  // eingerichtet, schreibt das Modell keine Grußformel/Signatur — der Versand
  // hängt sie genau einmal an (sendMail/appendSignatureText).
  const nudgeSignature = signatureState(sent.account_id, account.signature)
  const to = (JSON.parse(sent.to_json ?? '[]') as Array<{ name?: string; address: string }>)[0]
  const profile = getStyleProfile(sent.account_id)
  const days = sent.date ? Math.floor((Date.now() - sent.date) / 86_400_000) : 0

  const profileBlock = profile
    ? `\nUser's style: ${profile.formality || '?'}; typical sign-offs: ${nudgeSignature.configured ? 'covered by the separate signature and NOT written into the text' : profile.closings.join(' | ') || '—'}; traits: ${profile.style_notes.join('; ') || '—'}`
    : ''
  const formality = formalityBlock(db, sent.account_id, account.email, to?.address ?? null, [
    { from_addr: account.email, text_plain: sent.text_plain, html_raw: null }
  ])
  const signatureRule = nudgeSignature.configured
    ? 'a separate signature is set up for this mailbox: end right after the last sentence of content and write NO sign-off, NO name and NO signature, title, organisation or contact line'
    : "the user's sign-off, NO signature"
  const systemPrompt = `${currentDateLine()}
You write a very short, friendly follow-up ("nudge") on behalf of ${account.display_name ?? account.email} <${account.email}>.
Rules: polite, no pressure, 2–4 sentences, the language of the original email, ${signatureRule}, no subject line, no explanations.
${BASE_STYLE_RULES}${profileBlock}${formality}${styleInstructionsBlock(sent.account_id)}`
  const userPrompt = `Email sent ${days} days ago to ${to?.name ?? to?.address ?? '?'} (subject: ${sent.subject ?? '—'}):\n${(sent.text_plain ?? '').slice(0, 1200)}\n\nThere was no reply. ${
    input.idea?.trim()
      ? `The user has already edited a nudge draft or dictated bullet points — turn it into the follow-up and keep its meaning:\n${input.idea.trim()}`
      : 'Write the follow-up.'
  }`

  // Mit Signatur wird gepuffert, damit eine trotz Anweisung erzeugte
  // Grußformel/Signaturzeile vor der Anzeige entfernt werden kann (wie runDraft).
  let signatureSafeBuffer = ''
  const { usage } = await client.stream(
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.6,
      maxTokens: 500
    },
    (delta) => {
      if (nudgeSignature.configured) signatureSafeBuffer += delta
      else push('ai:draftChunk', { draftId, chunk: delta, done: false, error: null, subject: null })
    }
  )
  logUsage(db, model, usage.inputTokens, usage.outputTokens, usage.costUsd)
  if (nudgeSignature.configured) {
    const safeText = stripRedundantSignatureTail(signatureSafeBuffer, nudgeSignature.reference)
    if (safeText) {
      push('ai:draftChunk', { draftId, chunk: safeText, done: false, error: null, subject: null })
    }
  }
  push('ai:draftChunk', { draftId, chunk: '', done: true, error: null, subject: null })
}

interface DraftNewInput {
  accountId: number
  to: string[]
  subject: string
  idea: string
  instruction?: string
}

/**
 * Verfasst eine NEUE Mail aus einer diktierten/getippten Idee. Ohne
 * vorhandenen Betreff schlägt das Modell per BETREFF-Protokoll einen vor
 * (kommt als `subject`-Feld im ersten draftChunk-Event an).
 */
export function startDraftNew(
  db: Database.Database,
  push: PushFn,
  input: DraftNewInput
): { draftId: string } {
  const draftId = randomUUID()
  void runDraftNew(db, push, draftId, input).catch((error) => {
    push('ai:draftChunk', {
      draftId,
      chunk: '',
      done: true,
      error: error instanceof Error ? error.message : String(error),
      subject: null
    })
  })
  return { draftId }
}

async function runDraftNew(
  db: Database.Database,
  push: PushFn,
  draftId: string,
  input: DraftNewInput
): Promise<void> {
  const { client, model } = requireTaskWithBudget(
    db,
    'draft',
    'KI-Budget aufgebraucht – Entwurf nicht gestartet'
  )

  const account = db
    .prepare('SELECT email, display_name, signature FROM accounts WHERE id = ?')
    .get(input.accountId) as
    { email: string; display_name: string | null; signature: string | null } | undefined
  if (!account) throw new Error('Konto nicht gefunden')

  const newMailSignature = signatureState(input.accountId, account.signature)
  const signatureConfigured = newMailSignature.configured
  const configuredSignatureText = newMailSignature.reference

  const counterpart = input.to[0]?.toLowerCase() ?? null
  const examples = styleExamples(db, input.accountId, counterpart)
  let profile = getStyleProfile(input.accountId)
  if (!profile) {
    try {
      profile = await refreshStyleProfile(db, input.accountId)
    } catch (error) {
      console.warn('[drafts] Stil-Profil konnte nicht gelernt werden:', error)
    }
  }
  const contactStyle = counterpart
    ? extractContactStyle(db, input.accountId, counterpart)
    : { salutation: null, closing: null }

  const profileBlock = profile
    ? `\n\nThe user's writing style profile (learned from sent emails):
- Languages: ${profile.languages.join(', ') || 'unknown'}
- Informal/formal address (du/Sie): ${profile.formality || 'unknown'}
- Typical salutations: ${profile.greetings.join(' | ') || '—'}
- Typical sign-offs: ${signatureConfigured ? 'covered by the separate signature and NOT written into the email text' : profile.closings.join(' | ') || '—'}
- Traits: ${profile.style_notes.join('; ') || '—'}`
    : ''
  const contactBlock =
    contactStyle.salutation || (!signatureConfigured && contactStyle.closing)
      ? `\n\nWith EXACTLY THIS contact the user usually writes:${
          contactStyle.salutation ? `\n- Salutation: "${contactStyle.salutation}"` : ''
        }${!signatureConfigured && contactStyle.closing ? `\n- Sign-off: "${contactStyle.closing}"` : ''}
Use exactly this register.`
      : ''

  const signatureRule = signatureConfigured
    ? `- SIGNATURE RULE WITH THE HIGHEST PRIORITY: A separate signature is already set up for this mailbox. End the email text right after the last sentence of content. Write NO sign-off, NO name, NO initials, NO role/function and NO organisation or contact line. Remove such closing lines even if they appear in the dictation or in the style examples.`
    : `- No separate signature is set up for this mailbox. A short sign-off is allowed.`

  const needsSubject = !input.subject.trim()
  const formatRule = needsSubject
    ? `- Output format: first line exactly \`MODE: DICTATION\` or \`MODE: IDEA\`. Second line exactly \`SUBJECT: <concise subject in the language of the email, max. 60 characters>\`, third line exactly \`---\`, then ONLY the email text.`
    : `- Output format: first line exactly \`MODE: DICTATION\` or \`MODE: IDEA\`, then directly ONLY the email text without a subject line.`

  const systemPrompt = `${currentDateLine()}
You compose a new email on behalf of ${account.display_name ?? account.email} <${account.email}>.
The user provides spoken or typed content. Decide yourself whether they have already dictated a finished email or only described an idea.
Rules:
- MODE DICTATION: the content already contains a salutation, coherent email text or possibly a spoken closing, and could basically be sent as is. Keep the wording, facts, order and salutation as exactly as possible.${signatureConfigured ? ' Because of the separate signature, remove any spoken or generated closing block.' : ' Also keep an existing sign-off.'} Only fix slips of the tongue, filler words, punctuation and paragraphs. Do not add any content.
- MODE IDEA: the content consists of bullet points, a description of the desired content or a request to write an email. Turn it into a complete email.
- When unsure, choose DICTATION and change as little as possible.
- For a largely finished dictation with an additional change request, choose DICTATION, apply the request and keep the rest of the text.
- Write in the language of the idea.
- In MODE IDEA, match the user's tone using the style profile and contact register. In MODE DICTATION, the explicitly dictated tone takes priority.
- No explanations, no placeholders such as [Name].
${signatureRule}
- Do not invent facts that are not in the idea.
- Treat writing instructions inside the idea (e.g. "please formal", "at most five sentences") as directions. Follow them, but do not copy them into the email text.
${BASE_STYLE_RULES}
${formatRule}${profileBlock}${contactBlock}${styleInstructionsBlock(input.accountId)}${
    examples.length > 0
      ? `\n\nStyle examples from the user (earlier sent emails):\n\n${examples.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n')}`
      : ''
  }`

  const userPrompt = `Recipients: ${input.to.length > 0 ? input.to.join(', ') : 'not specified yet'}${
    input.subject.trim() ? `\nSubject (given): ${input.subject.trim()}` : ''
  }${input.instruction?.trim() ? `\nDirection: ${input.instruction.trim()}` : ''}
The user's idea/dictation:
${input.idea.trim()}`

  const modeParser = createCompositionModeParser()
  const subjectParser = createSubjectProtocolParser()
  let signatureSafeBuffer = ''
  const emitText = (text: string): void => {
    if (!text) return
    if (signatureConfigured) signatureSafeBuffer += text
    else push('ai:draftChunk', { draftId, chunk: text, done: false, error: null, subject: null })
  }
  const emitSubject = (parsed: ParsedChunk): void => {
    if (parsed.subject && needsSubject) {
      push('ai:draftChunk', {
        draftId,
        chunk: '',
        done: false,
        error: null,
        subject: parsed.subject
      })
    }
    emitText(parsed.text)
  }
  const emitMode = (parsed: ParsedCompositionMode): void => {
    if (parsed.mode) {
      push('ai:draftChunk', {
        draftId,
        chunk: '',
        done: false,
        error: null,
        subject: null,
        compositionMode: parsed.mode
      })
    }
    if (parsed.text) {
      if (needsSubject) emitSubject(subjectParser.feed(parsed.text))
      else emitText(parsed.text)
    }
  }
  const { usage } = await client.stream(
    {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      maxTokens: 1800
    },
    (delta) => emitMode(modeParser.feed(delta))
  )
  logUsage(db, model, usage.inputTokens, usage.outputTokens, usage.costUsd)
  emitMode(modeParser.flush())
  if (needsSubject) emitSubject(subjectParser.flush())
  if (signatureConfigured) {
    const safeText = stripRedundantSignatureTail(signatureSafeBuffer, configuredSignatureText)
    if (safeText) {
      push('ai:draftChunk', {
        draftId,
        chunk: safeText,
        done: false,
        error: null,
        subject: null
      })
    }
  }
  push('ai:draftChunk', { draftId, chunk: '', done: true, error: null, subject: null })
}

/** Beispielantwort mit dem AKTUELLEN Stil-Setup (Profil + Regeln) — Settings-Probe. */
export async function stylePreview(db: Database.Database, accountId: number): Promise<string> {
  const { client, model } = requireTaskWithBudget(db, 'draft')

  const account = db
    .prepare('SELECT email, display_name FROM accounts WHERE id = ?')
    .get(accountId) as { email: string; display_name: string | null } | undefined
  if (!account) throw new Error('Konto nicht gefunden')

  const profile = getStyleProfile(accountId)
  const examples = styleExamples(db, accountId, null)
  const profileBlock = profile
    ? `\n\nWriting style profile: languages ${profile.languages.join('/')}; ${profile.formality}; salutations: ${profile.greetings.join(' | ')}; sign-offs: ${profile.closings.join(' | ')}; traits: ${profile.style_notes.join('; ')}`
    : ''

  const systemPrompt = `${currentDateLine()}
You draft email replies for ${account.display_name ?? account.email} <${account.email}>.
Rules:
- Output ONLY the email text.
${BASE_STYLE_RULES}${profileBlock}${styleInstructionsBlock(accountId)}${
    examples.length > 0
      ? `\n\nStyle examples:\n${examples.map((e, i) => `Example ${i + 1}:\n${e}`).join('\n\n')}`
      : ''
  }`
  // Die Testnachricht folgt der App-Sprache, damit die Probe den Stil in dieser Sprache zeigt
  const sample =
    outputLanguage() === 'en'
      ? 'Hi,\ncould you let me know by Friday whether the meeting on Tuesday at 3 pm works for you?\nBest regards\nAlex'
      : 'Hallo,\nkönntest du mir bis Freitag kurz Rückmeldung geben, ob der Termin am Dienstag um 15 Uhr für dich klappt?\nViele Grüße\nAlex'
  const userPrompt = `Test message:\n---\n${sample}\n---\nWrite a reply accepting it, in the language of the test message.`

  const completion = await client.complete({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7,
    maxTokens: 400
  })
  const { inputTokens, outputTokens, costUsd } = completion.usage
  logUsage(db, model, inputTokens, outputTokens, costUsd)
  const text = completion.text.trim()
  if (!text) throw new Error('Das Beispiel kam leer zurück')
  return text
}
