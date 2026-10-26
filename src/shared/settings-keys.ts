/**
 * Allowlist of setting and secret keys the renderer may reach via
 * settings:get/settings:set/secrets:*. Everything else is strictly
 * main-process internal (e.g. OAuth client config `google.clientId`,
 * `google.clientSecret`, `ms.clientId` — a compromised renderer could
 * otherwise redirect them to a foreign client; also budgets,
 * notification thresholds and `images.allow.*`, which go through their own
 * channels).
 *
 * Dynamic families (per account) follow strict regexes; the account ID is
 * always a positive integer without a leading zero.
 */

const ID = '[1-9][0-9]{0,9}'

/** Keys the renderer may read AND write. */
const WRITABLE_EXACT = new Set([
  'ui.showList',
  'ui.showRail',
  'ui.language',
  // Appearance: 'letterpress' (default) | 'classic' (Outlook-like)
  'ui.layout',
  // 'light' | 'dark'
  'ui.theme',
  // Column widths as JSON {folders,list,rail}; folder pane on/off
  'ui.paneWidths',
  'ui.showFolderPane',
  // Folder view + sync of custom folders; '1' = on
  'mail.showFolders',
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
  // Drafts may use free time slots (without event details); '0' = off
  'ai.draftUseCalendar',
  'compose.draft',
  // Notifications without sender/subject/summary; thresholds stay internal
  'notifications.hideContent',
  // Spam/phishing confirmed by the model goes to the junk folder automatically; '1' = on
  'security.autoJunk'
])

const WRITABLE_PATTERNS = [
  new RegExp(`^sig\\.${ID}$`),
  new RegExp(`^ai\\.styleInstructions\\.${ID}$`),
  new RegExp(`^ai\\.style\\.learn\\.${ID}$`)
]

/**
 * Enum-shaped settings: the value is checked too, not only the key. These land
 * verbatim in the diagnostics export (PERF_SETTINGS) and in main-side branches.
 */
const BOOL = ['0', '1']
const ALLOWED_VALUES: Record<string, string[]> = {
  'ui.layout': ['letterpress', 'classic'],
  'ai.triageProvider': ['apple', 'openrouter'],
  'mail.showFolders': BOOL,
  'tasks.autoCreate': BOOL,
  'security.autoJunk': BOOL
}

/** Additionally read-only: style profiles computed by main, profile assignment, Local only. */
const READONLY_EXACT = new Set([
  'ai.styleProfile',
  'ai.styleMeta',
  // Profile assignment and Local only are written only by main via own channels
  // (ai:tasks:set, privacy:setLocalOnly) — the renderer may read them.
  'ai.triageProfile',
  'ai.draftProfile',
  'ai.sttProfile',
  'ai.decisionProfile',
  'privacy.localOnly'
])
const READONLY_PATTERNS = [
  new RegExp(`^ai\\.styleProfile\\.${ID}$`),
  new RegExp(`^ai\\.styleMeta\\.${ID}$`)
]

/** Secrets the renderer may set/check (never read). Account passwords go through accounts:add. */
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

/** Rejected key — the IPC layer returns only this short message. */
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

/** Value outside a setting's allowed set — same short message as a forbidden key. */
export function assertSettingValue(key: string, value: string): void {
  const allowed = ALLOWED_VALUES[key]
  if (allowed && !allowed.includes(value)) throw new ForbiddenKeyError('setting')
}

export function assertSecretKey(key: string): void {
  if (!isRendererSecretKey(key)) throw new ForbiddenKeyError('secret')
}
