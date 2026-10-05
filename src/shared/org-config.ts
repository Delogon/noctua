import { z } from 'zod'

/**
 * Organisations-Konfiguration („Company Edition"): optional, zur Build-Zeit
 * eingebettet (siehe docs/ORG-CONFIG.md). Ohne Datei bleibt jedes Verhalten
 * wie im Upstream. Alle Felder sind optional; unbekannte Felder sind ein
 * Fehler (Tippfehler sollen den Build stoppen, nicht still verpuffen).
 *
 * Bewusst in shared/: das Build-Skript (electron.vite.config.ts), der Main
 * und die Tests validieren gegen dasselbe Schema.
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

/** Reservierte Profil-IDs: eingebautes OpenRouter und Pseudo-Profil Apple On-Device. */
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
    /** Aufgabe → Modell; wird nur beim allerersten Anlegen des Profils zugewiesen. */
    tasks: z
      .object({
        triage: modelName.optional(),
        draft: modelName.optional(),
        stt: modelName.optional(),
        /** Entscheidungsmodell (Ollama System One, z. B. clef-flash) */
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

export const orgConfigSchema = z
  .object({
    productName: z.string().trim().min(1).max(60).optional(),
    /** Bundle-ID (Reverse-DNS) */
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
        /** block = Remote-Bilder blockieren (Upstream-Default), allow = laden */
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
    hideOpenRouterOnboarding: z.boolean().optional()
  })
  .strict()

export type OrgConfig = z.infer<typeof orgConfigSchema>
export type OrgAiProfile = z.infer<typeof orgAiProfileSchema>
export type UpdatesConfig = z.infer<typeof updatesConfigSchema>

/** Fehler als lesbare Zeilen („updates.repo: Format owner/name"). */
export function formatOrgConfigIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join('.') || '(Wurzel)'}: ${i.message}`)
}

/** Parst die rohe JSON-Zeichenkette; wirft mit allen Problemen auf einmal. */
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

/** Format der Update-Datei im Modus „url". */
export const updateManifestSchema = z.object({
  version: z
    .string()
    .max(40)
    .regex(/^v?\d+(\.\d+){0,2}/),
  url: httpsUrl,
  notes: z.string().max(2000).optional()
})
export type UpdateManifest = z.infer<typeof updateManifestSchema>

/** Standard-Updatequelle des Upstream. */
export const UPSTREAM_UPDATE_REPO = 'Schereo/noctua'

/** Namens-Ableitung (Datenordner/Executable) aus dem Produktnamen. */
export function slugifyProductName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'app'
  )
}
