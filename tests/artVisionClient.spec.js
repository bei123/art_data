import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('artVisionClient', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    process.env = {
      ...originalEnv,
      ART_VISION_ENABLED: 'true',
      ART_VISION_BASE_URL: 'http://127.0.0.1:3100',
      ART_VISION_INTERNAL_TOKEN: 'test-token',
      ART_VISION_TIMEOUT_MS: '5000',
    }
  })

  afterEach(() => {
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  it('isArtVisionEnabled returns false when disabled', async () => {
    process.env.ART_VISION_ENABLED = 'false'
    const { isArtVisionEnabled } = await import('../utils/artVisionClient.js')
    expect(isArtVisionEnabled()).toBe(false)
  })

  it('isArtVisionEnabled returns true when configured', async () => {
    const { isArtVisionEnabled } = await import('../utils/artVisionClient.js')
    expect(isArtVisionEnabled()).toBe(true)
  })

  it('searchExhibition posts image to art_vision', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ matched: true, engine: 'clip' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const { searchExhibition } = await import('../utils/artVisionClient.js')
    const result = await searchExhibition(3, 'abc123')

    expect(result.ok).toBe(true)
    expect(result.body.matched).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('http://127.0.0.1:3100/internal/exhibitions/3/search')
    expect(options.headers.Authorization).toBe('Bearer test-token')
    expect(JSON.parse(options.body)).toEqual({ image_base64: 'abc123' })
  })
})
