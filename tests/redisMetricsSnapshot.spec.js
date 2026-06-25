import { describe, it, expect } from 'vitest'
import {
  createEmptyRedisMetrics,
  buildRedisMetricsSnapshot,
} from '../utils/redisMetricsSnapshot.js'

describe('buildRedisMetricsSnapshot', () => {
  it('computes cache hit rate from GET hits and misses only', () => {
    const metrics = createEmptyRedisMetrics()
    metrics.cacheHits = 3
    metrics.cacheMisses = 1
    metrics.commandCounts.set = 10
    metrics.commandCounts.del = 5
    metrics.commandCounts.zset = 2
    metrics.commandCounts.get = 4

    const snapshot = buildRedisMetricsSnapshot(metrics)

    expect(snapshot.cache_hit_rate).toBe('75.00%')
    expect(snapshot.hitRate).toBe('75.00%')
    expect(snapshot.total_commands).toBe(21)
    expect(snapshot.totalRequests).toBe(21)
    expect(snapshot.cache_gets).toBe(4)
  })

  it('infers GET command count from cache hits and misses when get counter is zero', () => {
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

    const snapshot = buildRedisMetricsSnapshot(metrics)

    expect(snapshot.cache_hit_rate).toBe('0.00%')
    expect(snapshot.total_commands).toBe(4)
  })
})
