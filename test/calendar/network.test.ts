import { describe, expect, it } from 'vitest'
import { buildNetworkConnections } from '@main/network-connections'

describe('Netzwerkverbindungen: CalDAV', () => {
  const base = {
    accounts: [],
    profiles: [],
    taskProfiles: { triage: 'apple', draft: 'apple', stt: 'apple' } as const,
    localOnly: true,
    feed: { mode: 'off' } as never,
    embeddingsCached: true
  }

  it('Kalender-Server zählen wie Mail-Server: auch bei Local only aktiv (nie gesperrt)', () => {
    const list = buildNetworkConnections({
      ...base,
      taskProfiles: { ...base.taskProfiles },
      calendarAccounts: [
        { name: 'Nextcloud', serverUrl: 'https://cloud.example.com/remote.php/dav/' },
        { name: 'Lokal', serverUrl: 'http://localhost:5232/' }
      ]
    })
    const cal = list.filter((c) => c.kind === 'calendar')
    expect(cal).toEqual([
      expect.objectContaining({ host: 'cloud.example.com', scope: 'external', status: 'active' }),
      expect.objectContaining({ scope: 'local', status: 'active' })
    ])
  })
})
