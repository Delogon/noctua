import { describe, expect, it } from 'vitest'
import { inflateRawSync } from 'node:zlib'
import { createZip, crc32 } from '@main/diagnostics/zip'

/** Minimaler Leser über das zentrale Verzeichnis — prüft, was ein Unzip sähe. */
function readZip(buf: Buffer): Record<string, string> {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const out: Record<string, string> = {}
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const offset = buf.readUInt32LE(p + 42)
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8')
    const localNameLen = buf.readUInt16LE(offset + 26)
    const data = buf.subarray(offset + 30 + localNameLen, offset + 30 + localNameLen + size)
    const raw = method === 8 ? inflateRawSync(data) : data
    expect(crc32(raw)).toBe(crc)
    out[name] = raw.toString('utf8')
    p += 46 + nameLen
  }
  return out
}

describe('ZIP-Schreiber', () => {
  it('CRC32 (Referenzwert)', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926)
  })

  it('schreibt lesbare Einträge (Deflate und gespeichert, UTF-8-Namen)', () => {
    const big = JSON.stringify({ rows: new Array(500).fill({ a: 1, b: 'x' }) })
    const zip = createZip([
      { name: 'README.txt', data: 'Hallo Größe' },
      { name: 'sessions/s-1.json', data: big },
      { name: 'leer.txt', data: '' },
      { name: 'bin.dat', data: Buffer.from([0, 1, 2, 3]) }
    ])
    const files = readZip(zip)
    expect(Object.keys(files)).toEqual(['README.txt', 'sessions/s-1.json', 'leer.txt', 'bin.dat'])
    expect(files['README.txt']).toBe('Hallo Größe')
    expect(files['sessions/s-1.json']).toBe(big)
    expect(files['leer.txt']).toBe('')
    expect(zip.length).toBeLessThan(big.length)
  })
})
