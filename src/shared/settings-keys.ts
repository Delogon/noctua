/**
 * Allowlist der Einstellungs- und Secret-Schlüssel, die der Renderer über
 * settings:get/settings:set/secrets:* erreichen darf. Alles andere ist
 * ausschließlich Main-Prozess-intern (z. B. OAuth-Client-Konfiguration
 * `google.clientId`, `google.clientSecret`, `ms.clientId` — ein kompromittierter
 * Renderer könnte sie sonst auf einen fremden Client umbiegen; außerdem
 * Budgets, Benachrichtigungs-Schwellen und `images.allow.*`, die über eigene
 * Kanäle laufen).
 *
 * Dynamische Familien (pro Konto) folgen strikten Regexes; die Konto-ID ist
 * immer eine positive Ganzzahl ohne führende Null.
 */

const ID = '[1-9][0-9]{0,9}'

/** Keys, die der Renderer lesen UND schreiben darf. */
const WRITABLE_EXACT = new Set([
  'ui.showList',
  'ui.showRail',
  'ui.language',
  'noctua.onboarded',
  'noctua.onboardingStarted',
  'mail.remoteImagesDefault',
  'ai.zdrOnly',
  'ai.triageModel',
  'ai.draftModel',
  'ai.sttModel',
  'ai.triageProvider',
  'followup.waitDays',
  'tasks.autoCreate',
  'compose.draft'
])

const WRITABLE_PATTERNS = [
  new RegExp(`^sig\\.${ID}$`),
  new RegExp(`^ai\\.styleInstructions\\.${ID}$`),
  new RegExp(`^ai\\.style\\.learn\\.${ID}$`)
]

/** Zusätzlich nur lesbar: vom Main berechnete Stilprofile. */
const READONLY_EXACT = new Set(['ai.styleProfile', 'ai.styleMeta'])
const READONLY_PATTERNS = [
  new RegExp(`^ai\\.styleProfile\\.${ID}$`),
  new RegExp(`^ai\\.styleMeta\\.${ID}$`)
]

/** Secrets, die der Renderer setzen/prüfen darf (nie lesen). Konto-Passwörter laufen über accounts:add. */
const SECRET_EXACT = new Set(['openrouter.apiKey'])

export function isRendererSettingWritable(key: string): boolean {
  return WRITABLE_EXACT.has(key) || WRITABLE_PATTERNS.some((re) => re.test(key))
}

export function isRendererSettingReadable(key: string): boolean {
  return (
    isRendererSettingWritable(key) ||
    READONLY_EXACT.has(key) ||
    READONLY_PATTERNS.some((re) => re.test(key))
  )
}

export function isRendererSecretKey(key: string): boolean {
  return SECRET_EXACT.has(key)
}

/** Abgelehnter Schlüssel — der IPC-Layer gibt nur diese Kurzmeldung zurück. */
export class ForbiddenKeyError extends Error {
  constructor(kind: 'setting' | 'secret') {
    super(
      `Zugriff auf diesen ${kind === 'setting' ? 'Einstellungs' : 'Secret'}-Schlüssel ist nicht erlaubt`
    )
    this.name = 'ForbiddenKeyError'
  }
}

export function assertSettingReadable(key: string): void {
  if (!isRendererSettingReadable(key)) throw new ForbiddenKeyError('setting')
}

export function assertSettingWritable(key: string): void {
  if (!isRendererSettingWritable(key)) throw new ForbiddenKeyError('setting')
}

export function assertSecretKey(key: string): void {
  if (!isRendererSecretKey(key)) throw new ForbiddenKeyError('secret')
}
