import { describe, it, expect } from 'vitest'
import {
  createEmptyRedisMetrics,
  buildRedisMetricsSnapshot,
  classifyRedisGetPurpose,
  recordRedisGetResult,
} from '../utils/redisMetricsSnapshot.js'

describe('classifyRedisGetPurpose', () => {
  it('marks logistics and idempotency keys as probe', () => {
    expect(classifyRedisGetPurpose('logistics:path:terminal:1:SF123')).toBe('probe')
    expect(classifyRedisGetPurpose('logistics:path:seen:1:SF123')).toBe('probe')
    expect(classifyRedisGetPurpose('pay:inventory:fulfilled:ORD1')).toBe('probe')
    expect(classifyRedisGetPurpose('api_sign:nonce:wx-mini:abc')).toBe('probe')
    expect(classifyRedisGetPurpose('subscribe:sent:paid:ORD1')).toBe('probe')
  })

  it('marks list and detail keys as business cache', () => {
    expect(classifyRedisGetPurpose('artworks:list:1:20')).toBe('cache')
    expect(classifyRedisGetPurpose('artworks:detail:12')).toBe('cache')
    expect(classifyRedisGetPurpose('search:results:v1:abc')).toBe('cache')
    expect(classifyRedisGetPurpose('banners:list')).toBe('cache')
  })
})

describe('recordRedisGetResult', () => {
  it('splits hits and misses by purpose', () => {
    const metrics = createEmptyRedisMetrics()
    recordRedisGetResult(metrics, 'artworks:detail:1', true)
    recordRedisGetResult(metrics, 'artworks:detail:2', false)
    recordRedisGetResult(metrics, 'logistics:path:terminal:1:SF', false)
    recordRedisGetResult(metrics, 'logistics:path:seen:1:SF', true)

    expect(metrics.cacheHits).toBe(1)
    expect(metrics.cacheMisses).toBe(1)
    expect(metrics.probeHits).toBe(1)
    expect(metrics.probeMisses).toBe(1)
  })
})

describe('buildRedisMetricsSnapshot', () => {
  it('computes business cache hit rate excluding probe gets', () => {
    const metrics = createEmptyRedisMetrics()
    metrics.cacheHits = 3
    metrics.cacheMisses = 1
    metrics.probeHits = 0
    metrics.probeMisses = 40
    metrics.commandCounts.set = 10
    metrics.commandCounts.del = 5
    metrics.commandCounts.zset = 2
    metrics.commandCounts.get = 44

    const snapshot = buildRedisMetricsSnapshot(metrics)

    expect(snapshot.cache_hit_rate).toBe('75.00%')
    expect(snapshot.hitRate).toBe('75.00%')
    expect(snapshot.cache_gets).toBe(4)
    expect(snapshot.probe_gets).toBe(40)
    expect(snapshot.probe_hit_rate).toBe('0.00%')
    expect(snapshot.all_gets).toBe(44)
    expect(snapshot.all_get_hit_rate).toBe('6.82%')
    expect(snapshot.total_commands).toBe(61)
    expect(snapshot.totalRequests).toBe(61)
  })

  it('infers GET command count from cache and probe gets when get counter is zero', () => {
    const metrics = createEmptyRedisMetrics()
    metrics.cacheHits = 3
    metrics.cacheMisses = 1
    metrics.commandCounts.set = 10

    const snapshot = buildRedisMetricsSnapshot(metrics)

    expect(snapshot.total_commands).toBe(14)
    expect(snapshot.cache_gets).toBe(4)
  })

  it('returns zero hit rate when there are no cache reads', () => {
    const metrics = createEmptyRedisMetrics()
    metrics.commandCounts.setEx = 4
    metrics.probeMisses = 8

    const snapshot = buildRedisMetricsSnapshot(metrics)

    expect(snapshot.cache_hit_rate).toBe('0.00%')
    expect(snapshot.probe_gets).toBe(8)
    expect(snapshot.total_commands).toBe(12)
  })
})
