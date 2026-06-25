import { describe, it, expect, afterEach } from 'vitest'
import {
  REDIS_LIST_CACHE_TTL_SEC,
  REDIS_DETAIL_CACHE_TTL_SEC,
} from '../utils/redisCacheTtl.js'

describe('redisCacheTtl', () => {
  const prevList = process.env.REDIS_LIST_CACHE_TTL_SEC
  const prevDetail = process.env.REDIS_DETAIL_CACHE_TTL_SEC

  afterEach(() => {
    process.env.REDIS_LIST_CACHE_TTL_SEC = prevList
    process.env.REDIS_DETAIL_CACHE_TTL_SEC = prevDetail
  })

  it('defaults list and detail ttl to 7 days', () => {
    expect(REDIS_LIST_CACHE_TTL_SEC).toBe(604800)
    expect(REDIS_DETAIL_CACHE_TTL_SEC).toBe(604800)
  })
})
