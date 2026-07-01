const crypto = require('crypto')
const logger = require('./logger')
const redisClient = require('./redisClient')
const { REDIS_SEARCH_CACHE_TTL_SEC } = require('./redisCacheTtl')

const REDIS_SEARCH_CACHE_KEY_PREFIX = 'search:results:v1:'

/**
 * 构建搜索缓存键（keyword + type + 分页 + 可见性 + institution_id）
 */
function buildSearchCacheKey({
  keyword,
  type = 'all',
  page = 1,
  limit = 10,
  includeHidden = false,
  institutionId = null,
}) {
  const payload = {
    keyword: String(keyword || '').trim(),
    type: type || 'all',
    page: Number(page) || 1,
    limit: Number(limit) || 10,
    includeHidden: includeHidden ? 1 : 0,
    institutionId:
      institutionId != null && institutionId !== '' ? String(institutionId) : '',
  }
  const digest = crypto.createHash('sha256').update(JSON.stringify(payload), 'utf8').digest('hex')
  return `${REDIS_SEARCH_CACHE_KEY_PREFIX}${digest}`
}

async function getCachedSearchResult(cacheKey) {
  if (!cacheKey) return null

  try {
    const cached = await redisClient.safeGet(cacheKey)
    if (!cached) return null
    return JSON.parse(cached)
  } catch (err) {
    logger.warn('search_cache_read_failed', { err: err?.message || err })
    return null
  }
}

async function setCachedSearchResult(cacheKey, body) {
  if (!cacheKey || body == null) return

  const ttl = REDIS_SEARCH_CACHE_TTL_SEC
  if (!Number.isFinite(ttl) || ttl <= 0) return

  try {
    await redisClient.setEx(cacheKey, ttl, JSON.stringify(body))
  } catch (err) {
    logger.warn('search_cache_write_failed', { err: err?.message || err })
  }
}

/** 清除全部搜索缓存（艺术家/原作/数字藏品/机构变更时调用） */
async function invalidateSearchCaches() {
  try {
    const cleared = await redisClient.scanDelByPattern(`${REDIS_SEARCH_CACHE_KEY_PREFIX}*`, {
      swallowError: true,
    })
    if (cleared > 0) logger.info('invalidate_search_caches', { cleared })
    return cleared
  } catch (err) {
    logger.error('invalidate_search_caches_failed', { err })
    return 0
  }
}

module.exports = {
  REDIS_SEARCH_CACHE_KEY_PREFIX,
  buildSearchCacheKey,
  getCachedSearchResult,
  setCachedSearchResult,
  invalidateSearchCaches,
}
