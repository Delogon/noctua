import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3-multiple-ciphers'
import * as sqliteVec from 'sqlite-vec'

describe('better-sqlite3-multiple-ciphers', () => {
  it('lädt sqlite-vec und führt eine KNN-Abfrage aus', () => {
    const db = new Database(':memory:')
    sqliteVec.load(db)
    expect((db.prepare('SELECT vec_version() AS v').get() as { v: string }).v).toMatch(/^v/)
    db.exec('CREATE VIRTUAL TABLE v USING vec0(embedding float[3])')
    const ins = db.prepare('INSERT INTO v (rowid, embedding) VALUES (?, ?)')
    ins.run(1n, new Float32Array([1, 0, 0]))
    ins.run(2n, new Float32Array([0, 1, 0]))
    const rows = db
      .prepare('SELECT rowid FROM v WHERE embedding MATCH ? AND k = 1')
      .all(new Float32Array([0.9, 0.1, 0])) as { rowid: number }[]
    expect(Number(rows[0].rowid)).toBe(1)
    db.close()
  })

  it('unterstützt SQLCipher-4-Verschlüsselung (cipher=sqlcipher)', () => {
    const db = new Database(':memory:')
    db.pragma("cipher='sqlcipher'")
    expect(db.pragma('cipher', { simple: true })).toBe('sqlcipher')
    db.close()
  })
})
