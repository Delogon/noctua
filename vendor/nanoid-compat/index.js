'use strict'

/**
 * Ersatz für nanoid 2.x (CVE-2024-55565, CVE-2026-67213/-67214/-73086).
 * hunspell-asm und emscripten-wasm-loader rufen nur `nanoid(45)` auf
 * (wasm-FS-Pfadnamen). Gleiche API, aber Größe strikt validiert und
 * Zufall direkt aus node:crypto ohne gemeinsamen Pool.
 */
const { randomBytes } = require('node:crypto')

const ALPHABET = 'ModuleSymbhasOwnPr-0123456789ABCDEFGHNRVfgctiUvz_KqYTJkLxpZXIjQW'

function nanoid(size) {
  const length = size === undefined ? 21 : size
  if (!Number.isSafeInteger(length) || length <= 0 || length > 1024) {
    throw new RangeError('nanoid: size must be a positive integer up to 1024')
  }
  const bytes = randomBytes(length)
  let id = ''
  // 64 Zeichen → 6 Bit pro Byte, gleichverteilt
  for (let i = 0; i < length; i++) id += ALPHABET[bytes[i] & 63]
  return id
}

module.exports = nanoid
module.exports.default = nanoid
