export interface AccountRow {
  id: number
  email: string
  account_name: string
  display_name: string | null
  provider: 'gmail' | 'microsoft' | 'proton' | 'imap'
  credential_type: 'password' | 'oauth-ms' | 'oauth-google' | 'bridge'
  imap_host: string
  imap_port: number
  smtp_host: string
  smtp_port: number
  tls_fingerprint256: string | null
  ai_enabled: number
  color: string
  signature?: string | null
  /** Sync-Zeitraum in Tagen: null = Standard (90/183), 0 = alles. */
  sync_days: number | null
}

export const PROVIDER_DEFAULTS = {
  gmail: {
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    credentialType: 'password' as const
  },
  microsoft: {
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    smtpHost: 'smtp-mail.outlook.com',
    smtpPort: 587,
    credentialType: 'oauth-ms' as const
  },
  proton: {
    imapHost: '127.0.0.1',
    imapPort: 1143,
    smtpHost: '127.0.0.1',
    smtpPort: 1025,
    credentialType: 'bridge' as const
  }
}

export function accountSecretKey(accountId: number): string {
  return `account:${accountId}:password`
}

/** Entweder Passwort (Gmail/IMAP/Bridge) oder frisches OAuth-Token (Microsoft). */
export interface MailCredentials {
  user: string
  pass?: string
  accessToken?: string
}

/**
 * Loopback-Verbindungen (Proton Bridge & Co.) präsentieren selbstsignierte
 * Zertifikate — die CA-Prüfung würde sie immer ablehnen. Der Verkehr verlässt
 * den Rechner nicht (die Bridge spricht ihrerseits verschlüsselt mit Proton),
 * deshalb ist die Prüfung NUR für Loopback-Hosts aus; überall sonst bleibt
 * sie strikt an.
 */
export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized)
  )
}

/**
 * IMAP-Verbindungsoptionen pro Provider. OAuth-Konten liefern ein Access-Token
 * (imapflow spricht damit SASL XOAUTH2), Passwort-Konten ein pass.
 */
export function buildImapOptions(
  account: Pick<AccountRow, 'email' | 'provider' | 'imap_host' | 'imap_port'>,
  credentials: MailCredentials
): {
  host: string
  port: number
  secure: boolean
  doSTARTTLS?: boolean
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
  auth: { user: string; pass?: string; accessToken?: string }
  logger: false
  tls?: { rejectUnauthorized: boolean }
} {
  const loopback = isLoopbackHost(account.imap_host)
  const implicitTls = account.imap_port === 993
  return {
    host: account.imap_host,
    port: account.imap_port,
    // Port 993 = implizites TLS; sonst STARTTLS
    secure: implicitTls,
    // Nicht-Loopback: STARTTLS ist Pflicht (kein stilles Downgrade auf
    // Klartext). Loopback (Proton Bridge) bleibt wie bisher opportunistisch.
    ...(!loopback && !implicitTls ? { doSTARTTLS: true } : {}),
    // socketTimeout 5 min: imapflow fängt Timeouts im IDLE selbst ab (NOOP +
    // erneutes IDLE), ein kürzerer Wert würde dort unnötig Recovery auslösen.
    connectionTimeout: 30_000,
    greetingTimeout: 20_000,
    socketTimeout: 5 * 60_000,
    auth: credentials.accessToken
      ? { user: credentials.user, accessToken: credentials.accessToken }
      : { user: credentials.user, pass: credentials.pass },
    logger: false,
    ...(loopback ? { tls: { rejectUnauthorized: false } } : {})
  }
}
