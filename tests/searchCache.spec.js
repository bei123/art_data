import { describe, it, expect } from 'vitest'
import {
  buildSearchCacheKey,
  REDIS_SEARCH_CACHE_KEY_PREFIX,
} from '../utils/searchCache.js'

describe('searchCache', () => {
  it('builds stable keys for equivalent keywords', () => {
    const a = buildSearchCacheKey({
      keyword: '  张大千  ',
      type: 'all',
      page: 1,
      limit: 10,
      includeHidden: false,
    })
    const b = buildSearchCacheKey({
      keyword: '张大千',
      type: 'all',
      page: 1,
      limit: 10,
      includeHidden: false,
    })
    expect(a).toBe(b)
    expect(a.startsWith(REDIS_SEARCH_CACHE_KEY_PREFIX)).toBe(true)
  })

  it('differentiates type, page, visibility, and institution', () => {
    const base = {
      keyword: '测试',
      page: 1,
      limit: 10,
      includeHidden: false,
    }
    const all = buildSearchCacheKey({ ...base, type: 'all' })
    const artist = buildSearchCacheKey({ ...base, type: 'artist' })
    const page2 = buildSearchCacheKey({ ...base, type: 'all', page: 2 })
    const admin = buildSearchCacheKey({ ...base, type: 'all', includeHidden: true })
    const withInst = buildSearchCacheKey({ ...base, type: 'artist', institutionId: 3 })

    expect(new Set([all, artist, page2, admin, withInst]).size).toBe(5)
  })
})
