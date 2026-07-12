import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

describe('exhibitionVisionIndex', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    process.env = {
      ...originalEnv,
      ART_VISION_ENABLED: 'true',
      ART_VISION_BASE_URL: 'http://127.0.0.1:3100',
      ART_VISION_INTERNAL_TOKEN: 'test-token',
      ART_VISION_INDEX_DEBOUNCE_MS: '1000',
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
    vi.unstubAllGlobals()
  })

  it('debounces index sync and sends exhibition items', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ indexed_count: 2, candidate_count: 2 }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const loadCandidates = vi.fn(async () => ({
      exhibition: { id: 5, title: '测试展' },
      candidates: [
        {
          item_id: 1,
          artwork_type: 'original',
          artwork_id: '10',
          title: '作品A',
          image_url: 'https://example.com/a.jpg',
        },
      ],
    }))

    const { scheduleExhibitionVisionIndexSync } = await import('../utils/exhibitionVisionIndex.js')
    scheduleExhibitionVisionIndexSync(5, loadCandidates)
    scheduleExhibitionVisionIndexSync(5, loadCandidates)

    expect(loadCandidates).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)

    expect(loadCandidates).toHaveBeenCalledOnce()
    expect(loadCandidates).toHaveBeenCalledWith(5)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, options] = fetchMock.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body.exhibition_title).toBe('测试展')
    expect(body.items).toHaveLength(1)
  })

  it('syncs all published exhibitions on bootstrap', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ indexed_count: 1, candidate_count: 1 }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const loadCandidates = vi.fn(async (id) => ({
      exhibition: { id, title: `展${id}` },
      candidates: [{
        item_id: 1,
        artwork_type: 'original',
        artwork_id: '1',
        title: 'A',
        image_url: 'https://example.com/a.jpg',
      }],
    }))
    const listPublishedExhibitionIds = vi.fn(async () => [2, 3])

    const { syncAllPublishedExhibitionVisionIndexes } = await import('../utils/exhibitionVisionIndex.js')
    const result = await syncAllPublishedExhibitionVisionIndexes({
      loadCandidates,
      listPublishedExhibitionIds,
    })

    expect(result.synced).toBe(2)
    expect(result.total).toBe(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
