import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invoke } from '@renderer/lib/ipc'
import { useT } from '@renderer/lib/i18n'
import { cleanIpcError } from '@renderer/features/paper/account-states'
import type { AiProfile } from '@renderer/queries/intel'

// Onboarding-Schritt 3 in einer Company Edition mit `hideOpenRouterOnboarding`:
// statt der OpenRouter-Abfrage die von der Organisation bereitgestellten
// KI-Profile (managed). Pro Profil lässt sich der Key hinterlegen; lokale
// Profile brauchen keinen.

function OrgProfileRow({ profile }: { profile: AiProfile }): React.JSX.Element {
  const t = useT()
  const queryClient = useQueryClient()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (): void => {
    const value = key.trim()
    if (!value || busy) return
    setBusy(true)
    setError(null)
    invoke('ai:profiles:setKey', { id: profile.id, key: value })
      .then(() => {
        setKey('')
        void queryClient.invalidateQueries({ queryKey: ['ai'] })
      })
      .catch((err) => setError(cleanIpcError(err instanceof Error ? err.message : String(err))))
      .finally(() => setBusy(false))
  }

  const ready = profile.isLocal || profile.hasKey
  return (
    <div style={{ padding: '10px 0', borderTop: '1px solid var(--hairline)' }}>
      <div className="flex items-baseline gap-2">
        <span style={{ font: '500 12px var(--serif)' }}>{profile.name}</span>
        <span style={{ font: '400 9px var(--mono)', color: 'var(--muted)' }}>
          {profile.baseUrl.replace(/^https?:\/\//, '')}
        </span>
        <span
          className="ml-auto"
          style={{ font: '500 9px var(--mono)', color: ready ? 'var(--ink)' : 'var(--muted)' }}
        >
          {profile.hasKey ? t('obOrgKeySaved') : profile.isLocal ? t('obOrgNoKeyNeeded') : '—'}
        </span>
      </div>
      {!profile.isLocal && (
        <div className="flex gap-2" style={{ marginTop: 8 }}>
          <input
            value={key}
            onChange={(e) => {
              setKey(e.target.value)
              setError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              e.stopPropagation()
            }}
            type="password"
            autoComplete="off"
            placeholder={profile.hasKey ? t('profileKeySaved') : t('profileKeyPh')}
            className="paper-input flex-1"
            aria-label={`${profile.name} — ${t('profileKey')}`}
          />
          <button
            type="button"
            onClick={save}
            className="btn-bare flex-none"
            style={{
              font: '500 10px var(--mono)',
              letterSpacing: 1,
              color: 'var(--paper)',
              background: 'var(--ink)',
              padding: '8px 14px'
            }}
          >
            {busy ? '···' : t('obKeySave')}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" style={{ font: '400 9px var(--mono)', color: 'var(--ac)', marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  )
}

export function OnboardingOrgProfiles({ profiles }: { profiles: AiProfile[] }): React.JSX.Element {
  const t = useT()
  return (
    <div className="tint-card" style={{ padding: 14, marginTop: 22 }}>
      <div className="mlabel" style={{ color: 'var(--muted)', marginBottom: 4 }}>
        {t('obOrgProfilesLabel')}
      </div>
      {profiles.length === 0 ? (
        <div style={{ font: '400 9.5px var(--mono)', color: 'var(--muted)', marginTop: 6 }}>
          {t('obOrgNoProfiles')}
        </div>
      ) : (
        profiles.map((p) => <OrgProfileRow key={p.id} profile={p} />)
      )}
    </div>
  )
}
