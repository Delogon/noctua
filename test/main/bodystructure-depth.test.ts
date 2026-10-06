import { describe, expect, it } from 'vitest'
import { structureHasAttachments } from '@main/sync/account-syncer'

function nested(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  let node: Record<string, unknown> = leaf
  for (let i = 0; i < depth; i++) node = { type: 'multipart/mixed', childNodes: [node] }
  return node
}

describe('structureHasAttachments (vuln-0008)', () => {
  it('erkennt Anhänge in verschachtelten Strukturen', () => {
    expect(structureHasAttachments(nested(3, { disposition: 'ATTACHMENT' }))).toBe(true)
    expect(structureHasAttachments(nested(3, { disposition: 'inline' }))).toBe(false)
    expect(structureHasAttachments(null)).toBe(false)
  })

  it('übersteht eine bösartig tiefe BODYSTRUCTURE ohne Stack-Overflow', () => {
    const deep = nested(200_000, { disposition: 'attachment' })
    expect(structureHasAttachments(deep)).toBe(true)
    expect(structureHasAttachments(nested(200_000, {}))).toBe(false)
  })
})
