import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { renderSignatureImage } from '@main/smtp/signature-image'

async function pixel(image: Buffer, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return Array.from(data.subarray(offset, offset + 4))
}

describe('renderSignatureImage', () => {
  const source = sharp({
    create: { width: 12, height: 6, channels: 4, background: '#5b2587' }
  })
    .png()
    .toBuffer()

  it('brennt den gewaehlten Hintergrund in die PNG-Pixel ein', async () => {
    const result = await renderSignatureImage(
      await source,
      { width: 20, height: 12, padding: 3, objectFit: 'contain' },
      'rect',
      '#FFFFFF'
    )

    expect(await pixel(result, 0, 0)).toEqual([255, 255, 255, 255])
    expect(await pixel(result, 4, 4)).toEqual([91, 37, 135, 255])
  })

  it('laesst den Hintergrund bei der transparenten Option transparent', async () => {
    const result = await renderSignatureImage(
      await source,
      { width: 20, height: 12, padding: 3, objectFit: 'contain' },
      'rect',
      'transparent'
    )

    expect(await pixel(result, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('maskiert abgerundete Ecken auch bei festem Hintergrund', async () => {
    const result = await renderSignatureImage(
      await source,
      { width: 20, height: 12, padding: 3, objectFit: 'contain' },
      'rounded',
      '#FFFFFF'
    )

    expect((await pixel(result, 0, 0))[3]).toBe(0)
    expect(await pixel(result, 10, 1)).toEqual([255, 255, 255, 255])
  })
})
