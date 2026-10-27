import { useState } from 'react'
import { useAddAccount, useAddGoogle, useAddMicrosoft } from '@renderer/queries/accounts'
import { useT } from '@renderer/lib/i18n'
import { useUiStore } from '@renderer/stores/ui'
import { useEscapeClose } from '@renderer/lib/useEscapeClose'

type Provider = 'gmail' | 'microsoft' | 'imap'

/**
 * Account onboarding. Gmail and Microsoft via OAuth in the system browser
 * (no password in the app), generic IMAP with host/port and password.
 */
export function AddAccountDialog(): React.JSX.Element | null {
  const t = useT()
  const { addAccountOpen, setAddAccountOpen } = useUiStore()
  useEscapeClose(addAccountOpen, () => setAddAccountOpen(false))
  const addAccount = useAddAccount()
  const addMicrosoft = useAddMicrosoft()
  const addGoogle = useAddGoogle()
  const [provider, setProvider] = useState<Provider>('gmail')
  const [accountName, setAccountName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState('993')
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState('465')
  // '' = default (90 days list / 183 days search), '0' = everything, otherwise days
  const [syncDays, setSyncDays] = useState('')

  if (!addAccountOpen) return null

  const close = (): void => {
    setAddAccountOpen(false)
    addAccount.reset()
    addMicrosoft.reset()
    addGoogle.reset()
    setAccountName('')
    setEmail('')
    setPassword('')
  }

  // Gmail and Microsoft go through the browser login with their own button
  const oauth =
    provider === 'microsoft'
      ? {
          mutation: addMicrosoft,
          button: t('addMicrosoftButton'),
          note: t('addMicrosoftNote')
        }
      : provider === 'gmail'
        ? {
            mutation: addGoogle,
            button: t('addGoogleButton'),
            note: t('addGoogleNote')
          }
        : null

  const parsedSyncDays = syncDays === '' ? undefined : Number(syncDays)

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (provider !== 'imap') return // OAuth providers have their own login button
    addAccount.mutate(
      {
        provider,
        accountName: accountName.trim(),
        email: email.trim(),
        password,
        syncDays: parsedSyncDays,
        ...(provider === 'imap'
          ? {
              imapHost: imapHost.trim(),
              imapPort: Number(imapPort),
              smtpHost: smtpHost.trim(),
              smtpPort: Number(smtpPort)
            }
          : {})
      },
      { onSuccess: close }
    )
  }

  const inputClass = 'input'

  return (
    <div
      className="overlay pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <form onSubmit={submit} className="panel max-w-md p-5">
        <h2 className="text-[15px] font-semibold text-text">{t('addAccountTitle')}</h2>

        <div className="mt-4 flex gap-2">
          {(
            [
              ['gmail', 'Gmail'],
              ['microsoft', 'Microsoft'],
              ['imap', t('addImapGeneric')]
            ] as Array<[Provider, string]>
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setProvider(value)}
              className={`rounded-lg border px-3 py-1.5 text-[12.5px] transition-all duration-150 active:scale-95 ${
                provider === value
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border text-text-muted hover:border-border-strong'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <input
          required
          maxLength={40}
          placeholder={t('accountNamePh')}
          value={accountName}
          onChange={(event) => setAccountName(event.target.value)}
          className={`${inputClass} mt-4`}
        />

        <label className="mt-3 block text-[11.5px] text-text-muted">
          {t('addSyncRangeLabel')}
          <select
            value={syncDays}
            onChange={(event) => setSyncDays(event.target.value)}
            className={`${inputClass} mt-1`}
          >
            <option value="">{t('addSyncDefault')}</option>
            <option value="30">{t('addSync30')}</option>
            <option value="90">{t('addSync90')}</option>
            <option value="365">{t('addSync365')}</option>
            <option value="0">{t('addSyncAll')}</option>
          </select>
        </label>

        {oauth ? (
          <div className="mt-4 space-y-3">
            <p className="text-[12.5px] leading-relaxed text-text-muted">{oauth.note}</p>
            {oauth.mutation.isError && (
              <p className="anim-rise rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                {oauth.mutation.error instanceof Error
                  ? oauth.mutation.error.message
                  : t('addLoginFailed')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-ghost">
                {t('cancel')}
              </button>
              <button
                type="button"
                disabled={oauth.mutation.isPending || !accountName.trim()}
                onClick={() =>
                  oauth.mutation.mutate(
                    { accountName: accountName.trim(), syncDays: parsedSyncDays },
                    { onSuccess: close }
                  )
                }
                className="btn-primary"
              >
                {oauth.mutation.isPending ? t('addWaitingForBrowser') : oauth.button}
              </button>
            </div>
            {oauth.mutation.isPending && (
              <p className="text-[11.5px] text-text-faint">{t('addBrowserTabNote')}</p>
            )}
          </div>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              <input
                type="email"
                required
                placeholder={t('addEmailPh')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
              <input
                type="password"
                required
                placeholder={t('addPasswordPh')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
              {provider === 'imap' && (
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <input
                    required
                    placeholder={t('addImapHostPh')}
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    className={inputClass}
                  />
                  <input
                    required
                    placeholder={t('addPortPh')}
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                    className={inputClass}
                  />
                  <input
                    required
                    placeholder={t('addSmtpHostPh')}
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    className={inputClass}
                  />
                  <input
                    required
                    placeholder={t('addPortPh')}
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}
            </div>

            {addAccount.isError && (
              <p className="anim-rise mt-3 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
                {addAccount.error instanceof Error
                  ? addAccount.error.message
                  : t('addConnectionFailed')}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="btn-ghost">
                {t('cancel')}
              </button>
              <button type="submit" disabled={addAccount.isPending} className="btn-primary">
                {addAccount.isPending ? t('addChecking') : t('addConnect')}
              </button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
