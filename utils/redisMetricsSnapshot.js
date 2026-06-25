function createEmptyRedisMetrics() {
  return {
    commandCounts: {
      get: 0,
      set: 0,
      setEx: 0,
      del: 0,
      scan: 0,
      zset: 0,
      other: 0,
    },
    cacheHits: 0,
    cacheMisses: 0,
    safeGetFallbacks: 0,
    errors: 0,
    responseTimes: [],
  }
}

function buildRedisMetricsSnapshot(metrics) {
  const cacheGets = metrics.cacheHits + metrics.cacheMisses
  const hitRatePct = cacheGets > 0 ? (metrics.cacheHits / cacheGets) * 100 : 0
  const effectiveGetCount = Math.max(metrics.commandCounts.get, cacheGets)
  const totalCommands = effectiveGetCount
    + metrics.commandCounts.set
    + metrics.commandCounts.setEx
    + metrics.commandCounts.del
    + metrics.commandCounts.scan
    + metrics.commandCounts.zset
    + metrics.commandCounts.other
  const avgResponseTime = metrics.responseTimes.length > 0
    ? metrics.responseTimes.reduce((a, b) => a + b, 0) / metrics.responseTimes.length
    : 0

  return {
    cache_gets: cacheGets,
    cache_hits: metrics.cacheHits,
    cache_misses: metrics.cacheMisses,
    cache_hit_rate: `${hitRatePct.toFixed(2)}%`,
    safe_get_fallbacks: metrics.safeGetFallbacks,
    command_counts: { ...metrics.commandCounts },
    total_commands: totalCommands,
    errors: metrics.errors,
    error_rate: totalCommands > 0
      ? `${((metrics.errors / totalCommands) * 100).toFixed(2)}%`
      : '0%',
    avg_response_time_ms: `${avgResponseTime.toFixed(2)}ms`,
    max_response_time_ms: `${Math.max(...metrics.responseTimes, 0)}ms`,
    totalRequests: totalCommands,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
    hitRate: `${hitRatePct.toFixed(2)}%`,
    errorRate: totalCommands > 0
      ? `${((metrics.errors / totalCommands) * 100).toFixed(2)}%`
      : '0%',
    avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
    maxResponseTime: `${Math.max(...metrics.responseTimes, 0)}ms`,
  }
}

module.exports = {
  createEmptyRedisMetrics,
  buildRedisMetricsSnapshot,
}
