import { pinnedLoopbackTls, type PinnedTlsOptions } from './loopback-tls'

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
  /** Sync range in days: null = default (90/183), 0 = everything. */
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

/** Either a password (Gmail/IMAP/Bridge) or a fresh OAuth token (Microsoft). */
export interface MailCredentials {
  user: string
  pass?: string
  accessToken?: string
}

/**
 * Loopback connections (Proton Bridge & co.) present self-signed
 * certificates — the CA check would always reject them. Instead of the CA,
 * Noctua checks a pinned fingerprint there (trust-on-first-use, see
 * loopback-tls.ts); everywhere else the CA check stays strictly on.
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
 * IMAP connection options per provider. OAuth accounts provide an access token
 * (imapflow uses it for SASL XOAUTH2), password accounts a pass.
 */
export function buildImapOptions(
  account: Pick<AccountRow, 'email' | 'provider' | 'imap_host' | 'imap_port'>,
  credentials: MailCredentials,
  loopbackTls?: PinnedTlsOptions
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
  tls?: PinnedTlsOptions
} {
  const loopback = isLoopbackHost(account.imap_host)
  const implicitTls = account.imap_port === 993
  if (loopback && !loopbackTls) {
    throw new Error('Loopback-IMAP nur mit gepinntem Zertifikat (imapConnectOptions verwenden)')
  }
  return {
    host: account.imap_host,
    port: account.imap_port,
    // Port 993 = implicit TLS; otherwise STARTTLS
    secure: implicitTls,
    // STARTTLS is mandatory — also on loopback (Proton Bridge): no silent
    // downgrade to plaintext towards a process that has grabbed the port.
    ...(!implicitTls ? { doSTARTTLS: true } : {}),
    // socketTimeout 5 min: imapflow handles timeouts in IDLE itself (NOOP +
    // re-IDLE); a shorter value would trigger needless recovery there.
    connectionTimeout: 30_000,
    greetingTimeout: 20_000,
    socketTimeout: 5 * 60_000,
    auth: credentials.accessToken
      ? { user: credentials.user, accessToken: credentials.accessToken }
      : { user: credentials.user, pass: credentials.pass },
    logger: false,
    ...(loopback ? { tls: loopbackTls } : {})
  }
}

/** Like buildImapOptions, but first fetches the pinned certificate on loopback. */
export async function imapConnectOptions(
  account: Pick<AccountRow, 'email' | 'provider' | 'imap_host' | 'imap_port'> & {
    id?: number
  },
  credentials: MailCredentials
): Promise<ReturnType<typeof buildImapOptions>> {
  const loopbackTls = isLoopbackHost(account.imap_host)
    ? await pinnedLoopbackTls(
        account.id ?? null,
        account.imap_host,
        account.imap_port,
        'imap',
        account.imap_port === 993
      )
    : undefined
  return buildImapOptions(account, credentials, loopbackTls)
}
