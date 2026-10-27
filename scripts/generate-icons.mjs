/* eslint-disable @typescript-eslint/explicit-function-return-type -- build tooling in .mjs */
// Rasterizes build/icon.svg into all app icon artifacts:
//   build/icon.icns   (macOS bundle, via iconutil)
//   build/icon.png    (1024px, electron-builder fallback)
//   resources/icon.png (512px, dev dock icon)
// Usage: node scripts/generate-icons.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svg = readFileSync(join(root, 'build/icon.svg'))

async function png(size) {
  return sharp(svg, { density: (72 * size) / 1024 })
    .resize(size, size)
    .png()
    .toBuffer()
}

const iconset = join(root, 'build/icon.iconset')
rmSync(iconset, { recursive: true, force: true })
mkdirSync(iconset, { recursive: true })

// iconutil expects Apple's naming convention (base size + @2x variant).
const entries = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png']
]
for (const [size, name] of entries) {
  writeFileSync(join(iconset, name), await png(size))
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(root, 'build/icon.icns')])
rmSync(iconset, { recursive: true })

writeFileSync(join(root, 'build/icon.png'), await png(1024))
writeFileSync(join(root, 'resources/icon.png'), await png(512))
console.log('Icons generiert: build/icon.icns, build/icon.png, resources/icon.png')
