import { z } from 'zod'

/**
 * Organization config ("Company Edition"): optional, embedded at build time
 * (see docs/ORG-CONFIG.md). Without a file every behavior stays as in
 * upstream. All fields are optional; unknown fields are an error
 * (typos should stop the build, not silently fizzle out).
 *
 * Deliberately in shared/: the build script (electron.vite.config.ts), main
 * and the tests validate against the same schema.
 */

function protocolOk(value: string, allowed: string[]): boolean {
  try {
    return allowed.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

const httpsUrl = z
  .string()
  .max(500)
  .refine((v) => protocolOk(v, ['https:']), 'muss eine https://-URL sein')

const httpUrl = z
  .string()
  .max(500)
  .refine((v) => protocolOk(v, ['https:', 'http:']), 'muss eine http(s)://-URL sein')

/** Reserved profile IDs: built-in OpenRouter and the Apple on-device pseudo-profile. */
const RESERVED_PROFILE_IDS = ['openrouter', 'apple']

const modelName = z.string().trim().min(1).max(200)

export const orgAiProfileSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9_-]{1,40}$/, 'nur a-z, 0-9, _ und - (max. 40 Zeichen)')
      .refine((id) => !RESERVED_PROFILE_IDS.includes(id), 'reservierte ID'),
    name: z.string().trim().min(1).max(60),
    baseUrl: httpUrl,
    apiStyle: z.enum(['chat', 'responses']),
    isLocal: z.boolean(),
    /** Task → model; only assigned when the profile is first created. */
    tasks: z
      .object({
        triage: modelName.optional(),
        draft: modelName.optional(),
        stt: modelName.optional(),
        /** Decision model (Ollama System One, e.g. clef-flash) */
        decision: modelName.optional()
      })
      .strict()
      .optional()
  })
  .strict()

export const updatesConfigSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('github'),
      repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/, 'Format owner/name')
    })
    .strict(),
  z.object({ mode: z.literal('url'), url: httpsUrl }).strict(),
  z.object({ mode: z.literal('off') }).strict()
])

const domainName = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(/^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/, 'Domain, z. B. example.com')

/**
 * Spam/phishing rules (src/main/mail/threat-signals.ts): extra protected
 * brands (e.g. the company's own name) with their official domains, and
 * trusted domains whose senders and link targets never count as impersonation
 * or link deception.
 */
export const securityConfigSchema = z
  .object({
    brands: z
      .record(
        z.string().regex(/^[a-z0-9]{3,30}$/, 'ein Wort aus Kleinbuchstaben/Ziffern, 3–30 Zeichen'),
        z.array(domainName).min(1).max(20)
      )
      .refine((brands) => Object.keys(brands).length <= 50, 'höchstens 50 Marken')
      .optional(),
    trustedDomains: z.array(domainName).max(200).optional()
  })
  .strict()

export const orgConfigSchema = z
  .object({
    productName: z.string().trim().min(1).max(60).optional(),
    /** Bundle ID (reverse DNS) */
    appId: z
      .string()
      .max(120)
      .regex(/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, 'Reverse-DNS, z. B. com.example.mail')
      .optional(),
    executableName: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$/, 'nur Buchstaben, Ziffern, . _ -')
      .optional(),
    updates: updatesConfigSchema.optional(),
    links: z
      .object({ homepage: httpsUrl.optional(), support: httpsUrl.optional() })
      .strict()
      .optional(),
    defaults: z
      .object({
        localOnly: z.boolean().optional(),
        aiEnabledForNewAccounts: z.boolean().optional(),
        /** block = block remote images (upstream default), allow = load */
        remoteImagesDefault: z.enum(['block', 'allow']).optional(),
        language: z.enum(['de', 'en', 'auto']).optional()
      })
      .strict()
      .optional(),
    aiProfiles: z
      .array(orgAiProfileSchema)
      .max(20)
      .refine(
        (list) => new Set(list.map((p) => p.id)).size === list.length,
        'IDs müssen eindeutig sein'
      )
      .optional(),
    oauth: z
      .object({
        google: z
          .object({
            clientId: z.string().min(1).max(200),
            clientSecret: z.string().max(200).optional()
          })
          .strict()
          .optional(),
        microsoft: z
          .object({ clientId: z.string().min(1).max(200) })
          .strict()
          .optional()
      })
      .strict()
      .optional(),
    hideOpenRouterOnboarding: z.boolean().optional(),
    security: securityConfigSchema.optional()
  })
  .strict()

export type OrgConfig = z.infer<typeof orgConfigSchema>
export type OrgAiProfile = z.infer<typeof orgAiProfileSchema>
export type UpdatesConfig = z.infer<typeof updatesConfigSchema>
export type SecurityConfig = z.infer<typeof securityConfigSchema>

/** Errors as readable lines ("updates.repo: Format owner/name"). */
export function formatOrgConfigIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`)
}

/** Parses the raw JSON string; throws with all problems at once. */
export function parseOrgConfig(raw: string): OrgConfig {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (e) {
    throw new Error(`Org-Konfiguration ist kein gültiges JSON: ${(e as Error).message}`)
  }
  const result = orgConfigSchema.safeParse(json)
  if (!result.success) {
    throw new Error(
      `Ungültige Org-Konfiguration:\n  ${formatOrgConfigIssues(result.error).join('\n  ')}`
    )
  }
  return result.data
}

/** Format of the update file in "url" mode. */
export const updateManifestSchema = z.object({
  version: z
    .string()
    .max(40)
    .regex(/^v?\d+(\.\d+){0,2}/),
  url: httpsUrl,
  notes: z.string().max(2000).optional()
})
export type UpdateManifest = z.infer<typeof updateManifestSchema>

/** Upstream's default update source. */
export const UPSTREAM_UPDATE_REPO = 'Schereo/noctua'

/** Name derivation (data folder/executable) from the product name. */
export function slugifyProductName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  )
}
