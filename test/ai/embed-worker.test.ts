import { describe, expect, it, vi } from 'vitest'
import { ExtractorCache, type Extractor } from '@main/ai/embed-model'
import { handleEmbedRequest } from '@main/ai/embed-worker'

const fakeExtractor: Extractor = async (texts) => ({
  data: new Float32Array(texts.length * 768).map((_, i) => Math.floor(i / 768) + 1),
  dims: [texts.length, 768]
})

describe('embedding worker protocol', () => {
  it('returns one vector per text with the E5 prefix', async () => {
    const extractor = vi.fn(fakeExtractor)
    const cache = new ExtractorCache(async () => extractor)
    const response = await handleEmbedRequest(cache, {
      id: 7,
      cacheDir: '/tmp/models',
      allowDownload: false,
      texts: ['a', 'b'],
      prefix: 'passage'
    })
    expect(extractor).toHaveBeenCalledWith(['passage: a', 'passage: b'], {
      pooling: 'mean',
      normalize: true
    })
    if (!('vectors' in response)) throw new Error(response.error)
    expect(response.id).toBe(7)
    expect(response.vectors.map((v) => [v.length, v[0]])).toEqual([
      [768, 1],
      [768, 2]
    ])
    // Each vector owns its buffer, so it can be transferred
    expect(response.vectors[0].buffer).not.toBe(response.vectors[1].buffer)
  })

  it('reports load errors and retries the load on the next request', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('not cached'), { name: 'LoadError' }))
      .mockResolvedValue(fakeExtractor)
    const cache = new ExtractorCache(load)
    const request = {
      id: 1,
      cacheDir: '/tmp/models',
      allowDownload: false,
      texts: ['x'],
      prefix: 'query' as const
    }
    expect(await handleEmbedRequest(cache, request)).toEqual({
      id: 1,
      error: 'not cached',
      name: 'LoadError'
    })
    const retry = await handleEmbedRequest(cache, { ...request, id: 2, allowDownload: true })
    expect('vectors' in retry && retry.vectors.length).toBe(1)
    expect(load).toHaveBeenLastCalledWith('/tmp/models', true)
  })

  it('only loads the model when no texts are given', async () => {
    const extractor = vi.fn(fakeExtractor)
    const cache = new ExtractorCache(async () => extractor)
    expect(
      await handleEmbedRequest(cache, {
        id: 3,
        cacheDir: '/tmp/models',
        allowDownload: true,
        texts: [],
        prefix: 'passage'
      })
    ).toEqual({ id: 3, vectors: [] })
    expect(extractor).not.toHaveBeenCalled()
  })
})
