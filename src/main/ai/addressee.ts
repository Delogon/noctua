/**
 * Addressee detection for task extraction: tasks may only be
 * created if the account owner is really meant — not for
 * distribution-list delivery to others ("Hallo Jannik" via mailing list).
 *
 * Three stages, here as pure functions:
 *   1. Envelope: where is the account address (To/CC/not at all)?
 *   2. Salutation: whom does the first line address by name?
 *   3. LLM: addressed_to_me from triage (probabilistic, default true).
 * `taskAddresseeVerdict` combines everything into 'create' | 'suggest' | 'none'.
 */

export type RecipientPlacement = 'to' | 'cc' | 'absent'

export type SalutationTarget =
  { kind: 'named'; names: string[] } | { kind: 'group' } | { kind: 'none' }

export type AddresseeVerdict = 'create' | 'suggest' | 'none'

export interface OwnerIdentity {
  email?: string | null
  displayName?: string | null
  accountName?: string | null
}

function parseAddressList(json: string | null | undefined): string[] | null {
  if (json == null) return null
  try {
    const list = JSON.parse(json) as Array<{ address?: string | null }>
    if (!Array.isArray(list)) return null
    return list.map((r) => (r.address ?? '').trim().toLowerCase()).filter(Boolean)
  } catch {
    return null
  }
}

/**
 * Stage 1 — placement of the account address in the envelope.
 * 'absent' = neither To nor CC (distribution-list/Bcc delivery).
 * Without an account address or usable envelope data, neutral 'to',
 * so incomplete legacy data doesn't wrongly suppress anything.
 */
export function recipientPlacement(
  accountEmail: string | null | undefined,
  toJson: string | null | undefined,
  ccJson: string | null | undefined
): RecipientPlacement {
  const email = accountEmail?.trim().toLowerCase()
  if (!email) return 'to'
  const to = parseAddressList(toJson)
  const cc = parseAddressList(ccJson)
  if (to === null && cc === null) return 'to'
  if (to?.includes(email)) return 'to'
  if (cc?.includes(email)) return 'cc'
  return 'absent'
}

// Greetings at the start of a line ("Hallo", "Sehr geehrte Frau …", "Dear …").
const GREETING =
  /^(?:hallo|hall(?:ö|o)chen|hi|hey|hej|huhu|moin(?:\s+moin)?|servus|gr(?:ü|u)(?:ß|ss)\s+(?:dich|euch|gott)|guten\s+(?:morgen|tag|abend)|liebste[rs]?|liebe[rs]?|sehr\s+geehrte[rs]?|werte[rs]?|dear|hello|good\s+(?:morning|afternoon|evening))\b/i

// Salutations to a group or directly to "you, the reader" — no name signal.
const GROUP_TARGET =
  /^(?:ihr\s+lieben|damen\s+und\s+herren|kolleg\p{L}*(?:\s+und\s+kolleg\p{L}*)?|team\p{L}*|zusammen|alle(?:rseits)?|miteinander|leute|freunde|folks|everyone|everybody|all|guys|ihr|du|sie)\b/iu

// Titles before names that contribute nothing to the comparison.
const TITLE = /^(?:herrn?|frau|fr(?:ä|a)ulein|dr|prof|mr|mrs|ms|miss|sir|madam)\.?$/i

function firstUnquotedLine(text: string): string | null {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[\u200b-\u200d\ufeff\ufffc]/g, '').trim()
    if (!line) continue
    if (line.startsWith('>')) continue
    return line
  }
  return null
}

function cleanNameToken(token: string): string {
  return token.replace(/^[("'„“”«»]+/, '').replace(/[.,!?:;)"'„“”«»]+$/, '')
}

// Name token: capitalized, only letters/hyphen/apostrophe.
// Requiring capitalization is deliberate: a wrong "foreign name" would be
// a hard no — when in doubt, better stay neutral.
function isNameToken(token: string): boolean {
  if (token.length < 2 || token.length > 30) return false
  return /^\p{Lu}[\p{L}'’-]*$/u.test(token)
}

/**
 * Stage 2 — whom does the first non-quoted line address?
 * 'named' with the detected names, 'group' for "zusammen"/"alle"/"Team"/…,
 * 'none' without a (usable) salutation.
 */
export function salutationTarget(bodyText: string | null | undefined): SalutationTarget {
  const line = firstUnquotedLine(bodyText ?? '')
  if (!line) return { kind: 'none' }
  const greeting = GREETING.exec(line)
  if (!greeting) return { kind: 'none' }
  const rest = line
    .slice(greeting[0].length)
    .replace(/^[\s,!:;–—-]+/, '')
    .trim()
  if (!rest) return { kind: 'none' }
  if (GROUP_TARGET.test(rest)) return { kind: 'group' }

  // "Hallo Tim und Anna," / "Liebe Marie, lieber Tom, hier …" — segments up to
  // the first non-name (that's where the sentence begins).
  const names: string[] = []
  for (const segment of rest.split(/\s*(?:,|;|\bund\b|\band\b|&|\+|\/)\s*/i)) {
    if (!segment) continue
    const withoutGreeting = segment.replace(GREETING, '').replace(/^[\s,!]+/, '')
    const tokens = withoutGreeting
      .split(/\s+/)
      .map(cleanNameToken)
      .filter((t) => t.length > 0 && !TITLE.test(t))
    if (tokens.length === 0) continue // pure title segment
    if (tokens.length > 3 || !tokens.every(isNameToken)) break
    names.push(tokens.join(' '))
  }
  return names.length > 0 ? { kind: 'named', names } : { kind: 'none' }
}

// Case- and diacritic-tolerant normalization (Jörg → jorg, Groß → gross).
function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function nameTokens(value: string): string[] {
  return normalizeName(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 2)
}

/**
 * Stage 2b — does a salutation name the account owner? Compared against
 * name tokens from display_name, account_name and the local part of the
 * address (lena.hartmann → lena, hartmann; lena.hartmann12 also without digits).
 */
export function namesMatchOwner(names: string[], owner: OwnerIdentity): boolean {
  const ownerTokens = new Set<string>()
  const add = (value: string | null | undefined): void => {
    for (const token of nameTokens(value ?? '')) {
      ownerTokens.add(token)
      const withoutDigits = token.replace(/\p{N}+/gu, '')
      if (withoutDigits.length >= 2) ownerTokens.add(withoutDigits)
    }
  }
  add(owner.displayName)
  add(owner.accountName)
  add(owner.email?.split('@')[0])
  if (ownerTokens.size === 0) return false
  return names.some((name) => nameTokens(name).some((token) => ownerTokens.has(token)))
}

export interface AddresseeContext {
  accountEmail?: string | null
  displayName?: string | null
  accountName?: string | null
  toJson?: string | null
  ccJson?: string | null
  /** Own mail text (without forwarded block) for the salutation analysis. */
  bodyText?: string | null
  /** LLM assessment addressed_to_me; missing/null = true (legacy annotations). */
  addressedToMe?: boolean | null
}

/**
 * Overall policy: is the account owner meant?
 *   - Salutation names the owner (alone or among several) ⇒ 'create' —
 *     also overrides 'absent' (personally addressed via distribution list).
 *   - Salutation names EXCLUSIVELY other names ⇒ 'none' (even when in To).
 *   - Neither To nor CC (distribution list/Bcc) ⇒ 'none'; CC only ⇒ 'none' (as before).
 *   - Otherwise (To + neutral salutation): addressed_to_me=false ⇒ suggestion only
 *     ('suggest'), otherwise 'create'.
 * 'create' means "may be created automatically" — the M50 toggle
 * (tasks.autoCreate) still sits ABOVE this policy.
 */
export function taskAddresseeVerdict(ctx: AddresseeContext): AddresseeVerdict {
  const owner: OwnerIdentity = {
    email: ctx.accountEmail,
    displayName: ctx.displayName,
    accountName: ctx.accountName
  }
  const salutation = salutationTarget(ctx.bodyText)
  if (salutation.kind === 'named') {
    return namesMatchOwner(salutation.names, owner) ? 'create' : 'none'
  }
  const placement = recipientPlacement(ctx.accountEmail, ctx.toJson, ctx.ccJson)
  if (placement !== 'to') return 'none'
  return ctx.addressedToMe === false ? 'suggest' : 'create'
}
