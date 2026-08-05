/**
 * Redis GET 用途分类：
 * - cache: 列表/详情/token 等业务缓存（命中率应对齐这个）
 * - probe: 幂等旗标、锁、物流轮询状态等「查是否存在」读（空值是常态，不应稀释业务命中率）
 */
const PROBE_KEY_PREFIXES = [
  'logistics:path:terminal:',
  'logistics:path:seen:',
  'pay:inventory:fulfilled:',
  'pay:settled:side:',
  'refund:inventory:restored:',
  'pay:callback:',
  'favor:notify:done:',
  'favor:notify:lock:',
  'subscribe:sent:',
  'subscribe:virtual:',
  'subscribe:pending:',
  'api_sign:nonce:',
]

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
    probeHits: 0,
    probeMisses: 0,
    safeGetFallbacks: 0,
    errors: 0,
    responseTimes: [],
    startedAt: Date.now(),
  }
}

function classifyRedisGetPurpose(key) {
  const normalized = String(key || '')
  if (!normalized) return 'cache'
  for (const prefix of PROBE_KEY_PREFIXES) {
    if (normalized.startsWith(prefix)) return 'probe'
  }
  return 'cache'
}

function formatRatePct(hits, total) {
  if (!total || total <= 0) return '0.00%'
  return `${((hits / total) * 100).toFixed(2)}%`
}

function avgMs(responseTimes) {
  if (!responseTimes || responseTimes.length === 0) return 0
  return responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
}

function recordRedisGetResult(metrics, key, hasValue) {
  const purpose = classifyRedisGetPurpose(key)
  if (purpose === 'probe') {
    if (hasValue) metrics.probeHits += 1
    else metrics.probeMisses += 1
    return purpose
  }
  if (hasValue) metrics.cacheHits += 1
  else metrics.cacheMisses += 1
  return purpose
}

function buildRedisMetricsSnapshot(metrics, options = {}) {
  const cacheGets = metrics.cacheHits + metrics.cacheMisses
  const probeGets = metrics.probeHits + metrics.probeMisses
  const allGets = cacheGets + probeGets
  const hitRatePct = cacheGets > 0 ? (metrics.cacheHits / cacheGets) * 100 : 0
  const allHitRatePct = allGets > 0
    ? ((metrics.cacheHits + metrics.probeHits) / allGets) * 100
    : 0
  const effectiveGetCount = Math.max(metrics.commandCounts.get, allGets)
  const totalCommands = effectiveGetCount
    + metrics.commandCounts.set
    + metrics.commandCounts.setEx
    + metrics.commandCounts.del
    + metrics.commandCounts.scan
    + metrics.commandCounts.zset
    + metrics.commandCounts.other
  const avgResponseTime = avgMs(metrics.responseTimes)
  const startedAt = metrics.startedAt || null
  const windowMs = startedAt != null
    ? Math.max(0, (options.now || Date.now()) - startedAt)
    : null

  return {
    // 主指标：仅业务缓存 GET
    cache_gets: cacheGets,
    cache_hits: metrics.cacheHits,
    cache_misses: metrics.cacheMisses,
    cache_hit_rate: `${hitRatePct.toFixed(2)}%`,
    // 幂等/轮询探测 GET（空读属常态）
    probe_gets: probeGets,
    probe_hits: metrics.probeHits,
    probe_misses: metrics.probeMisses,
    probe_hit_rate: formatRatePct(metrics.probeHits, probeGets),
    // 全量 GET（旧口径，便于对比）
    all_gets: allGets,
    all_get_hit_rate: `${allHitRatePct.toFixed(2)}%`,
    safe_get_fallbacks: metrics.safeGetFallbacks,
    command_counts: { ...metrics.commandCounts },
    total_commands: totalCommands,
    errors: metrics.errors,
    error_rate: totalCommands > 0
      ? `${((metrics.errors / totalCommands) * 100).toFixed(2)}%`
      : '0%',
    avg_response_time_ms: `${avgResponseTime.toFixed(2)}ms`,
    max_response_time_ms: `${Math.max(...(metrics.responseTimes || []), 0)}ms`,
    window_ms: windowMs,
    started_at: startedAt ? new Date(startedAt).toISOString() : null,
    // 兼容旧字段
    totalRequests: totalCommands,
    cacheHits: metrics.cacheHits,
    cacheMisses: metrics.cacheMisses,
    hitRate: `${hitRatePct.toFixed(2)}%`,
    errorRate: totalCommands > 0
      ? `${((metrics.errors / totalCommands) * 100).toFixed(2)}%`
      : '0%',
    avgResponseTime: `${avgResponseTime.toFixed(2)}ms`,
    maxResponseTime: `${Math.max(...(metrics.responseTimes || []), 0)}ms`,
  }
}

module.exports = {
  PROBE_KEY_PREFIXES,
  createEmptyRedisMetrics,
  classifyRedisGetPurpose,
  recordRedisGetResult,
  buildRedisMetricsSnapshot,
}
