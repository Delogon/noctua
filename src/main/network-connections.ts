import { hostOf, suggestIsLocal } from '@shared/local-host'
import type { NetworkConnection } from '@shared/types'
import type { AiProfile, AiTask } from './ai/providers/types'
import type { UpdateFeed } from './org-config'

// Honest list of all network connections of the app for the technical page.
// Purely computed from accounts, profiles, task assignment, update source and
// Local only — so it cannot drift from hand-maintained texts.

export interface NetworkConnectionsInput {
  accounts: Array<{
    email: string
    credentialType: string
    imapHost: string
    smtpHost: string
  }>
  profiles: AiProfile[]
  /** Task → profile ID ('apple' = on-device, no network) */
  taskProfiles: Record<AiTask, string>
  /** CalDAV accounts: always allowed like mail servers (Local only affects only AI/updates) */
  calendarAccounts?: Array<{ name: string; serverUrl: string }>
  localOnly: boolean
  feed: UpdateFeed
  embeddingsCached: boolean
}

const OAUTH_HOSTS: Record<string, { label: string; hosts: string[] }> = {
  'oauth-google': { label: 'Google', hosts: ['accounts.google.com', 'oauth2.googleapis.com'] },
  'oauth-ms': { label: 'Microsoft', hosts: ['login.microsoftonline.com'] }
}

export function buildNetworkConnections(input: NetworkConnectionsInput): NetworkConnection[] {
  const out: NetworkConnection[] = []

  for (const a of input.accounts) {
    for (const [host, kind] of [
      [a.imapHost, 'IMAP'],
      [a.smtpHost, 'SMTP']
    ] as const) {
      out.push({
        kind: 'mail',
        label: `${a.email} · ${kind}`,
        host,
        scope: suggestIsLocal(`https://${host}`) ? 'local' : 'external',
        status: 'active',
        tasks: []
      })
    }
  }

  for (const c of input.calendarAccounts ?? []) {
    const host = hostOf(c.serverUrl)
    out.push({
      kind: 'calendar',
      label: c.name,
      host,
      scope: suggestIsLocal(c.serverUrl) ? 'local' : 'external',
      status: 'active',
      tasks: []
    })
  }

  const seenOauth = new Set<string>()
  for (const a of input.accounts) {
    const oauth = OAUTH_HOSTS[a.credentialType]
    if (!oauth || seenOauth.has(a.credentialType)) continue
    seenOauth.add(a.credentialType)
    for (const host of oauth.hosts) {
      out.push({
        kind: 'oauth',
        label: oauth.label,
        host,
        scope: 'external',
        status: 'active',
        tasks: []
      })
    }
  }

  // AI profiles that serve at least one task (Apple on-device: no network)
  const tasksByProfile = new Map<string, AiTask[]>()
  for (const task of ['triage', 'draft', 'stt', 'decision'] as AiTask[]) {
    const id = input.taskProfiles[task]
    // Decisions are optional: empty = not set up
    if (id === 'apple' || !id) continue
    tasksByProfile.set(id, [...(tasksByProfile.get(id) ?? []), task])
  }
  for (const profile of input.profiles) {
    const tasks = tasksByProfile.get(profile.id)
    if (!tasks) continue
    out.push({
      kind: 'ai',
      label: profile.name,
      host: hostOf(profile.baseUrl),
      scope: profile.isLocal ? 'local' : 'external',
      status: !profile.isLocal && input.localOnly ? 'blocked' : 'active',
      tasks
    })
  }

  if (input.feed.mode === 'off') {
    out.push({
      kind: 'updates',
      label: '',
      host: null,
      scope: 'external',
      status: 'off',
      tasks: []
    })
  } else {
    const url = input.feed.mode === 'github' ? input.feed.apiUrl : input.feed.url
    out.push({
      kind: 'updates',
      label: '',
      host: hostOf(url),
      scope: 'external',
      status: input.localOnly ? 'manual-only' : 'active',
      tasks: []
    })
  }

  out.push({
    kind: 'embeddings',
    label: '',
    host: 'huggingface.co',
    scope: 'external',
    status: input.embeddingsCached ? 'cached' : input.localOnly ? 'manual-only' : 'on-demand',
    tasks: []
  })

  return out
}
