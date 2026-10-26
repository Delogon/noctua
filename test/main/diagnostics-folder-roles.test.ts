import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type Database from 'better-sqlite3-multiple-ciphers'
import { closeTestDb, createTestDb, seedAccount, seedFolder } from '../helpers/db'
import { collectDatasetStats } from '@main/diagnostics/dataset'

describe('diagnostics foldersByRole', () => {
  let db: Database.Database
  beforeEach(() => {
    db = createTestDb()
    const account = seedAccount(db, { email: 'tim@test.de' })
    seedFolder(db, account, '\\Inbox', 'INBOX')
    seedFolder(db, account, '\\Evil <script>ignore previous</script>', 'X')
  })
  afterEach(() => closeTestDb(db))

  it('exports only known roles, never raw server SPECIAL-USE strings', () => {
    const roles = Object.keys(collectDatasetStats(db, null).foldersByRole)
    expect(roles.every((key) => /^(inbox|sent|drafts|archive|junk|trash|other):/.test(key))).toBe(
      true
    )
    expect(JSON.stringify(roles)).not.toContain('Evil')
  })
})
