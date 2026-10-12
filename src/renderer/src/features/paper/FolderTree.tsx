import { useMemo } from 'react'
import type { AccountSummary, FolderListItem } from '@shared/types'
import { useAccounts } from '@renderer/queries/accounts'
import { useFolders, useMboxCounts } from '@renderer/queries/threads'
import { usePaper, type Mbox } from '@renderer/stores/paper'
import { useT } from '@renderer/lib/i18n'
import type { StringKey } from '@renderer/i18n/strings'
import { folderTreeEntries } from './folder-tree'

/**
 * Folder tree (folder view): the unified views on top, below them the folders
 * per account. Spam is always last and dimmed — it never belongs to the
 * shared inbox; only those who open it deliberately see it.
 */

interface Target {
  accountId: number | null
  mbox: Mbox
  folderId: number | null
}

const ROLE_LABEL: Partial<Record<FolderListItem['role'], StringKey>> = {
  inbox: 'folderInbox',
  sent: 'folderSent',
  archive: 'folderArchive',
  junk: 'folderJunk'
}

function FolderButton({
  label,
  count,
  depth,
  junk,
  active,
  onClick
}: {
  label: string
  count?: number
  depth: number
  junk?: boolean
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="folder-tree__item"
      data-active={active}
      data-junk={junk === true}
      aria-current={active ? 'true' : undefined}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={onClick}
      title={label}
    >
      <span className="folder-tree__name">{label}</span>
      {count !== undefined && count > 0 && <span className="folder-tree__count">{count}</span>}
    </button>
  )
}

export function FolderTree({
  showUserFolders
}: {
  /** false: only the fixed folders per account (Classic without folder view). */
  showUserFolders: boolean
}): React.JSX.Element {
  const t = useT()
  const { filter, mbox, folderId, openFolder } = usePaper()
  const accounts = useAccounts()
  const folders = useFolders()
  const counts = useMboxCounts(null)

  const byAccount = useMemo(() => {
    const map = new Map<number, FolderListItem[]>()
    for (const f of folders.data ?? []) {
      if (!showUserFolders && f.role === 'other') continue
      const list = map.get(f.accountId) ?? []
      list.push(f)
      map.set(f.accountId, list)
    }
    return map
  }, [folders.data, showUserFolders])

  const isActive = (target: Target): boolean =>
    target.folderId !== null
      ? folderId === target.folderId
      : folderId === null && mbox === target.mbox && filter === target.accountId

  const unifiedInboxUnread = (folders.data ?? [])
    .filter((f) => f.role === 'inbox')
    .reduce((sum, f) => sum + f.unreadCount, 0)

  const unified: Array<{ label: string; target: Target; count?: number; junk?: boolean }> = [
    {
      label: t('folderUnified'),
      target: { accountId: null, mbox: 'inbox', folderId: null },
      count: unifiedInboxUnread
    },
    { label: t('folderUnifiedSent'), target: { accountId: null, mbox: 'sent', folderId: null } },
    {
      label: t('folderUnifiedJunk'),
      target: { accountId: null, mbox: 'spam', folderId: null },
      count: counts.data?.spam,
      junk: true
    }
  ]

  const accountList: AccountSummary[] = accounts.data ?? []
  const multi = accountList.length > 1

  return (
    <nav className="folder-tree" aria-label={t('foldersTreeAria')}>
      {multi &&
        unified.map((u) => (
          <FolderButton
            key={u.target.mbox}
            label={u.label}
            count={u.count}
            depth={0}
            junk={u.junk}
            active={isActive(u.target)}
            onClick={() => openFolder(u.target)}
          />
        ))}
      {accountList.map((account) => {
        const entries = folderTreeEntries(byAccount.get(account.id) ?? [])
        return (
          <div key={account.id} className="folder-tree__account">
            <div className="folder-tree__head" title={account.email}>
              <span
                className="folder-tree__swatch"
                style={{ background: account.color }}
                aria-hidden="true"
              />
              <span className="folder-tree__name">{account.accountName || account.email}</span>
            </div>
            {entries.map(({ folder, depth }) => {
              const roleLabel = ROLE_LABEL[folder.role]
              const target: Target = {
                accountId: account.id,
                mbox: folder.role === 'sent' ? 'sent' : folder.role === 'junk' ? 'spam' : 'inbox',
                // An account's inbox = account filter on the shared view
                folderId: folder.role === 'inbox' ? null : folder.id
              }
              return (
                <FolderButton
                  key={folder.id}
                  label={roleLabel ? t(roleLabel) : folder.name}
                  count={folder.role === 'junk' ? folder.threadCount : folder.unreadCount}
                  depth={depth + 1}
                  junk={folder.role === 'junk'}
                  active={isActive(target)}
                  onClick={() => openFolder(target)}
                />
              )
            })}
          </div>
        )
      })}
      {showUserFolders && (folders.data ?? []).every((f) => f.role !== 'other') && (
        <div className="folder-tree__note">{t('foldersSyncing')}</div>
      )}
      <div className="folder-tree__note">{t('foldersJunkNote')}</div>
    </nav>
  )
}
