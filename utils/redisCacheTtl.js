function parsePositiveTtlSec(raw, fallbackSec) {
  const parsed = parseInt(raw, 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return fallbackSec
}

/** 列表类缓存兜底 TTL（默认 7 天）；写路径仍应在变更时主动 del */
const REDIS_LIST_CACHE_TTL_SEC = parsePositiveTtlSec(
  process.env.REDIS_LIST_CACHE_TTL_SEC,
  604800,
)

/** 详情类缓存兜底 TTL（默认 7 天） */
const REDIS_DETAIL_CACHE_TTL_SEC = parsePositiveTtlSec(
  process.env.REDIS_DETAIL_CACHE_TTL_SEC,
  604800,
)

/** 搜索接口缓存 TTL（默认 5 分钟）；写路径变更时会 scan 清除 */
const REDIS_SEARCH_CACHE_TTL_SEC = parsePositiveTtlSec(
  process.env.REDIS_SEARCH_CACHE_TTL_SEC,
  300,
)

module.exports = {
  REDIS_LIST_CACHE_TTL_SEC,
  REDIS_DETAIL_CACHE_TTL_SEC,
  REDIS_SEARCH_CACHE_TTL_SEC,
}
