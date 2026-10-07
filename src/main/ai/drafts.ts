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
  return `\n\nANREDE-REGEL (hat VORRANG vor dem Stil-Profil und allen anderen Vorgaben): Im Verlauf mit diesem Kontakt gilt ${
    form === 'sie'
      ? 'das förmliche SIE — konsequent siezen (Sie/Ihnen/Ihre), keinesfalls duzen'
      : 'das DU — konsequent duzen, nicht siezen'
  }.`
}

/** Harte Schreibregeln für ALLE Entwürfe (Tims Vorgabe, M30). */
const BASE_STYLE_RULES =
  '- Keine Spiegelstriche oder Aufzählungszeichen, keine Gedankenstriche (– oder —) und keine Semikolons: schreibe in vollständigen Sätzen und normalen Absätzen.'

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
  return `\n\nVom Nutzer festgelegte Stil-Anweisungen (haben VORRANG vor allem anderen):\n${parts.join('\n')}`
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
    ? `\n\nSchreibstil-Profil des Nutzers (gelernt aus gesendeten Mails):
- Sprachen: ${profile.languages.join(', ') || 'unbekannt'}
- Du/Sie: ${profile.formality || 'unbekannt'}
- Typische Anreden: ${profile.greetings.join(' | ') || '—'}
- Typische Grußformeln: ${replySignature.configured ? 'werden durch die separate Signatur abgedeckt und NICHT in den Antworttext geschrieben' : profile.closings.join(' | ') || '—'}
- Merkmale: ${profile.style_notes.join('; ') || '—'}`
    : ''
  const contactBlock =
    contactStyle.salutation || (!replySignature.configured && contactStyle.closing)
      ? `\n\nBei GENAU DIESEM Kontakt schreibt der Nutzer üblicherweise:${
          contactStyle.salutation ? `\n- Anrede: "${contactStyle.salutation}"` : ''
        }${!replySignature.configured && contactStyle.closing ? `\n- Gruß: "${contactStyle.closing}"` : ''}
Verwende exakt dieses Register.`
      : ''

  const systemPrompt = `${currentDateLine()}
Du entwirfst E-Mail-Antworten für ${account.display_name ?? account.email} <${account.email}>.
${UNTRUSTED_SYSTEM_NOTE}
Regeln:
- Antworte in der Sprache der letzten eingehenden Nachricht.
- Triff den Ton des Nutzers: Stil-Profil und Kontakt-Register unten sind maßgeblich,
  die Stilbeispiele zeigen ihn in Aktion.
- Gib NUR den E-Mail-Text aus: keine Betreffzeile, keine Erklärungen, keine Platzhalter wie [Name].
${
  replySignature.configured
    ? '- Für dieses Postfach ist eine separate Signatur eingerichtet. Beende direkt nach dem letzten inhaltlichen Satz. Schreibe KEINE Grußformel, KEINEN Namen und KEINE Signatur-, Titel-, Organisations- oder Kontaktzeile.'
    : '- Beende mit der Grußformel des Nutzers und höchstens seinem Vornamen.'
}
- Sei konkret und knapp und erfinde keine Fakten, die nicht im Thread stehen.
${BASE_STYLE_RULES}${profileBlock}${contactBlock}${formality}${styleInstructionsBlock(accountId)}${availability ?? ''}${
    examples.length > 0
      ? `\n\nStilbeispiele des Nutzers (frühere gesendete Mails):\n\n${examples.map((e, i) => `Beispiel ${i + 1}:\n${e}`).join('\n\n')}`
      : ''
  }`

  const userPrompt = `Unterhaltung (älteste zuerst):\n\n${threadContext}\n\nSchreibe eine Antwort auf die letzte Nachricht von ${sanitizeUntrustedLine(lastForeign.from_name ?? lastForeign.from_addr, 120)}.${
    input.instruction ? `\nAnweisung des Nutzers: ${input.instruction}` : ''
  }${
    input.reviseText?.trim() && input.idea?.trim()
      ? `\nEs existiert bereits dieser Entwurf des Nutzers:\n---ENTWURF---\n${input.reviseText.trim()}\n---ENDE ENTWURF---\nArbeite die folgenden Änderungswünsche in den Entwurf ein und gib die vollständige überarbeitete Antwort aus. Alles, was von den Wünschen nicht betroffen ist, bleibt wortgleich erhalten:\n${input.idea.trim()}`
      : input.idea?.trim()
        ? `\nDer Nutzer hat als Grundlage diese Stichpunkte/dieses Diktat geliefert — forme daraus die Antwort:\n${input.idea.trim()}`
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
  const HEADER = 'MODUS:'
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
        mode: rawMode === 'DIKTAT' ? 'dictation' : rawMode === 'IDEE' ? 'idea' : null,
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
          mode: rawMode === 'DIKTAT' ? 'dictation' : rawMode === 'IDEE' ? 'idea' : null,
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
  const HEADER = 'BETREFF:'
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
    ? `\nStil des Nutzers: ${profile.formality || '?'}; typische Grußformeln: ${nudgeSignature.configured ? 'werden durch die separate Signatur abgedeckt und NICHT in den Text geschrieben' : profile.closings.join(' | ') || '—'}; Merkmale: ${profile.style_notes.join('; ') || '—'}`
    : ''
  const formality = formalityBlock(db, sent.account_id, account.email, to?.address ?? null, [
    { from_addr: account.email, text_plain: sent.text_plain, html_raw: null }
  ])
  const signatureRule = nudgeSignature.configured
    ? 'Für dieses Postfach ist eine separate Signatur eingerichtet: beende direkt nach dem letzten inhaltlichen Satz und schreibe KEINE Grußformel, KEINEN Namen und KEINE Signatur-, Titel-, Organisations- oder Kontaktzeile'
    : 'Grußformel des Nutzers, KEINE Signatur'
  const systemPrompt = `${currentDateLine()}
Du schreibst einen sehr kurzen, freundlichen Nachfass ("Stups") im Namen von ${account.display_name ?? account.email} <${account.email}>.
Regeln: höflich, ohne Druck, 2–4 Sätze, Sprache der Original-Mail, ${signatureRule}, keine Betreffzeile, keine Erklärungen.
${BASE_STYLE_RULES}${profileBlock}${formality}${styleInstructionsBlock(sent.account_id)}`
  const userPrompt = `Vor ${days} Tagen gesendete Mail an ${to?.name ?? to?.address ?? '?'} (Betreff: ${sent.subject ?? '—'}):\n${(sent.text_plain ?? '').slice(0, 1200)}\n\nEs kam keine Antwort. ${
    input.idea?.trim()
      ? `Der Nutzer hat bereits einen Stups-Entwurf bearbeitet bzw. Stichpunkte diktiert — forme daraus den Nachfass und bewahre seinen Wortsinn:\n${input.idea.trim()}`
      : 'Schreibe den Nachfass.'
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
    ? `\n\nSchreibstil-Profil des Nutzers (gelernt aus gesendeten Mails):
- Sprachen: ${profile.languages.join(', ') || 'unbekannt'}
- Du/Sie: ${profile.formality || 'unbekannt'}
- Typische Anreden: ${profile.greetings.join(' | ') || '—'}
- Typische Grußformeln: ${signatureConfigured ? 'werden durch die separate Signatur abgedeckt und NICHT in den Mailtext geschrieben' : profile.closings.join(' | ') || '—'}
- Merkmale: ${profile.style_notes.join('; ') || '—'}`
    : ''
  const contactBlock =
    contactStyle.salutation || (!signatureConfigured && contactStyle.closing)
      ? `\n\nBei GENAU DIESEM Kontakt schreibt der Nutzer üblicherweise:${
          contactStyle.salutation ? `\n- Anrede: "${contactStyle.salutation}"` : ''
        }${!signatureConfigured && contactStyle.closing ? `\n- Gruß: "${contactStyle.closing}"` : ''}
Verwende exakt dieses Register.`
      : ''

  const signatureRule = signatureConfigured
    ? `- SIGNATUR-REGEL MIT HÖCHSTER PRIORITÄT: Für dieses Postfach ist bereits eine separate Signatur eingerichtet. Beende den Mailtext direkt nach dem letzten inhaltlichen Satz. Schreibe KEINE Grußformel, KEINEN Namen, KEINE Initialen, KEINE Rolle/Funktion und KEINE Organisations- oder Kontaktzeile. Entferne solche Schlusszeilen auch dann, wenn sie im Diktat vorkommen oder in Stilbeispielen stehen.`
    : `- Für dieses Postfach ist keine separate Signatur eingerichtet. Eine kurze Grußformel ist erlaubt.`

  const needsSubject = !input.subject.trim()
  const formatRule = needsSubject
    ? `- Ausgabeformat: Erste Zeile exakt \`MODUS: DIKTAT\` oder \`MODUS: IDEE\`. Zweite Zeile exakt \`BETREFF: <prägnanter Betreff, max. 60 Zeichen>\`, dritte Zeile exakt \`---\`, danach NUR der E-Mail-Text.`
    : `- Ausgabeformat: Erste Zeile exakt \`MODUS: DIKTAT\` oder \`MODUS: IDEE\`, danach direkt NUR der E-Mail-Text ohne Betreffzeile.`

  const systemPrompt = `${currentDateLine()}
Du verfasst eine neue E-Mail im Namen von ${account.display_name ?? account.email} <${account.email}>.
Der Nutzer liefert gesprochenen oder getippten Inhalt. Erkenne selbst, ob er bereits eine fertige Mail diktiert oder nur eine Idee beschrieben hat.
Regeln:
- MODUS DIKTAT: Der Inhalt enthält bereits Anrede, zusammenhängenden Mailtext oder möglicherweise einen gesprochenen Schluss und kann grundsätzlich so versendet werden. Bewahre Wortlaut, Fakten, Reihenfolge und Anrede möglichst exakt.${signatureConfigured ? ' Entferne wegen der separaten Signatur jeden gesprochenen oder erzeugten Schlussblock.' : ' Bewahre auch eine vorhandene Grußformel.'} Korrigiere nur Versprecher, Füllwörter, Zeichensetzung und Absätze. Ergänze nichts Inhaltliches.
- MODUS IDEE: Der Inhalt besteht aus Stichpunkten, einer Beschreibung des gewünschten Inhalts oder einer Aufforderung, eine Mail zu verfassen. Forme daraus eine vollständige Mail.
- Bei Unsicherheit wähle DIKTAT und verändere so wenig wie möglich.
- Bei einem weitgehend fertigen Diktat mit einer zusätzlichen Änderungsanweisung wähle DIKTAT, wende die Anweisung an und erhalte den übrigen Text.
- Schreibe in der Sprache der Idee.
- Im Modus IDEE triff den Ton des Nutzers anhand von Stil-Profil und Kontakt-Register. Im Modus DIKTAT hat der ausdrücklich diktierte Ton Vorrang.
- Keine Erklärungen, keine Platzhalter wie [Name].
${signatureRule}
- Erfinde keine Fakten, die nicht in der Idee stehen.
- Erkenne Schreibanweisungen innerhalb der Idee (z. B. „bitte förmlich“, „maximal fünf Sätze“) als Regie. Befolge sie, aber übernimm sie nicht in den Mailtext.
${BASE_STYLE_RULES}
${formatRule}${profileBlock}${contactBlock}${styleInstructionsBlock(input.accountId)}${
    examples.length > 0
      ? `\n\nStilbeispiele des Nutzers (frühere gesendete Mails):\n\n${examples.map((e, i) => `Beispiel ${i + 1}:\n${e}`).join('\n\n')}`
      : ''
  }`

  const userPrompt = `Empfänger: ${input.to.length > 0 ? input.to.join(', ') : 'noch nicht angegeben'}${
    input.subject.trim() ? `\nBetreff (vorgegeben): ${input.subject.trim()}` : ''
  }${input.instruction?.trim() ? `\nRegie-Anweisung: ${input.instruction.trim()}` : ''}
Idee/Diktat des Nutzers:
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
    ? `\n\nSchreibstil-Profil: Sprachen ${profile.languages.join('/')}; ${profile.formality}; Anreden: ${profile.greetings.join(' | ')}; Grußformeln: ${profile.closings.join(' | ')}; Merkmale: ${profile.style_notes.join('; ')}`
    : ''

  const systemPrompt = `${currentDateLine()}
Du entwirfst E-Mail-Antworten für ${account.display_name ?? account.email} <${account.email}>.
Regeln:
- Gib NUR den E-Mail-Text aus.
${BASE_STYLE_RULES}${profileBlock}${styleInstructionsBlock(accountId)}${
    examples.length > 0
      ? `\n\nStilbeispiele:\n${examples.map((e, i) => `Beispiel ${i + 1}:\n${e}`).join('\n\n')}`
      : ''
  }`
  const userPrompt = `Testnachricht:\n---\nHallo,\nkönntest du mir bis Freitag kurz Rückmeldung geben, ob der Termin am Dienstag um 15 Uhr für dich klappt?\nViele Grüße\nAlex\n---\nSchreibe eine zusagende Antwort darauf.`

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
