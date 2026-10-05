import sharp from 'sharp'
import type { SignatureImageLayout, SignatureImageShape } from '@shared/signature'

function rgba(hex: string): { r: number; g: number; b: number; alpha: number } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return { r: 0, g: 0, b: 0, alpha: 0 }
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
    alpha: 1
  }
}

/**
 * Rechnet Groesse, Innenabstand und Hintergrund in die versendete PNG ein.
 * Mail-Clients koennen eingebettete Bildpixel im Dark Mode nicht wie eine
 * CSS-Hintergrundfarbe umfaerben.
 */
export async function renderSignatureImage(
  source: Buffer,
  layout: SignatureImageLayout,
  shape: SignatureImageShape | undefined,
  background: string
): Promise<Buffer> {
  const contentWidth = Math.max(1, layout.width - layout.padding * 2)
  const contentHeight = Math.max(1, layout.height - layout.padding * 2)
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 }
  const image = await sharp(source)
    .rotate()
    .resize(contentWidth, contentHeight, {
      fit: shape === 'circle' ? 'cover' : 'contain',
      position: 'centre',
      background: transparent
    })
    .png()
    .toBuffer()

  const layers: Array<{
    input: Buffer
    left?: number
    top?: number
    blend?: 'dest-in'
  }> = [{ input: image, left: layout.padding, top: layout.padding }]
  if (shape === 'circle' || shape === 'rounded') {
    const radius =
      shape === 'circle'
        ? Math.min(layout.width, layout.height) / 2
        : Math.min(10, layout.width / 2, layout.height / 2)
    layers.push({
      input: Buffer.from(
        `<svg width="${layout.width}" height="${layout.height}"><rect width="100%" height="100%" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
      ),
      blend: 'dest-in'
    })
  }

  return sharp({
    create: {
      width: layout.width,
      height: layout.height,
      channels: 4,
      background: rgba(background)
    }
  })
    .composite(layers)
    .png()
    .toBuffer()
}
