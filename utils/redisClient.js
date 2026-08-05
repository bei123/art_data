const redis = require('redis')
const logger = require('./logger')
const {
  createEmptyRedisMetrics,
  buildRedisMetricsSnapshot,
  recordRedisGetResult,
} = require('./redisMetricsSnapshot')

function parseRedisDatabase() {
  const parsed = parseInt(process.env.REDIS_DB ?? '2', 10)
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 15) return 2
  return parsed
}

function buildRedisSocketOptions() {
  const socket = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10) || 6379,
    connectTimeout: 10000,
    keepAlive: 30000,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error('Redis 重连失败次数过多，停止重连')
        return new Error('Redis 重连失败')
      }
      return Math.min(retries * 100, 3000)
    },
  }

  if (process.env.REDIS_TLS === 'true') {
    socket.tls = true
    if (process.env.REDIS_TLS_REJECT_UNAUTHORIZED === 'false') {
      socket.rejectUnauthorized = false
    }
  }

  return socket
}

const redisConfig = {
  socket: buildRedisSocketOptions(),
  database: parseRedisDatabase(),
  password: process.env.REDIS_PASSWORD || undefined,
  disableOfflineQueue: true,
}

const redisClient = redis.createClient(redisConfig)

redisClient.on('connect', () => {
  logger.info('Redis 连接已建立')
})

redisClient.on('ready', () => {
  logger.info('Redis 客户端已就绪')
})

redisClient.on('error', (err) => {
  logger.error('Redis 错误', { err: err?.message || err })
})

redisClient.on('end', () => {
  logger.info('Redis 连接已关闭')
})

redisClient.on('reconnecting', () => {
  logger.info('Redis 正在重连')
})

const METRICS_SAMPLE_LIMIT = 1000
const METRICS_LOG_INTERVAL_MS = parseInt(process.env.REDIS_METRICS_LOG_INTERVAL_MS || '300000', 10)

const redisMetrics = {
  window: createEmptyRedisMetrics(),
  lifetime: createEmptyRedisMetrics(),
}

function forEachMetricsBucket(fn) {
  fn(redisMetrics.window)
  fn(redisMetrics.lifetime)
}

function recordResponseTime(ms) {
  forEachMetricsBucket((bucket) => {
    bucket.responseTimes.push(ms)
    if (bucket.responseTimes.length > METRICS_SAMPLE_LIMIT) {
      bucket.responseTimes.splice(0, bucket.responseTimes.length - METRICS_SAMPLE_LIMIT)
    }
  })
}

function incrementCommand(category, ms = null) {
  forEachMetricsBucket((bucket) => {
    const target = bucket.commandCounts[category] != null ? category : 'other'
    bucket.commandCounts[target] += 1
  })
  if (ms != null) recordResponseTime(ms)
}

function incrementErrors() {
  forEachMetricsBucket((bucket) => {
    bucket.errors += 1
  })
}

function recordGetOutcome(key, hasValue) {
  forEachMetricsBucket((bucket) => {
    recordRedisGetResult(bucket, key, hasValue)
  })
}

const originalGet = redisClient.get.bind(redisClient)
const originalSet = redisClient.set.bind(redisClient)
const originalSetEx = redisClient.setEx.bind(redisClient)
const originalDel = redisClient.del.bind(redisClient)

redisClient.get = async function getWithMetrics(key) {
  const startTime = Date.now()

  try {
    const result = await originalGet(key)
    const elapsed = Date.now() - startTime
    incrementCommand('get', elapsed)
    recordGetOutcome(key, Boolean(result))
    if (elapsed > 100) {
      logger.warn('Redis 慢查询 GET', { ms: elapsed, key })
    }
    return result
  } catch (error) {
    incrementErrors()
    logger.error('Redis GET 错误', { key, err: error?.message || error })
    throw error
  }
}

redisClient.set = async function setWithMetrics(...args) {
  const startTime = Date.now()

  try {
    const result = await originalSet(...args)
    const elapsed = Date.now() - startTime
    incrementCommand('set', elapsed)
    if (elapsed > 100) {
      logger.warn('Redis 慢查询 SET', { ms: elapsed, key: args[0] })
    }
    return result
  } catch (error) {
    incrementErrors()
    logger.error('Redis SET 错误', { err: error?.message || error })
    throw error
  }
}

redisClient.setEx = async function setExWithMetrics(key, ttl, value) {
  const startTime = Date.now()

  try {
    const result = await originalSetEx(key, ttl, value)
    const elapsed = Date.now() - startTime
    incrementCommand('setEx', elapsed)
    if (elapsed > 100) {
      logger.warn('Redis 慢查询 SETEX', { ms: elapsed, key })
    }
    return result
  } catch (error) {
    incrementErrors()
    logger.error('Redis SETEX 错误', { key, err: error?.message || error })
    throw error
  }
}

function normalizeDelKeyArgs(args) {
  if (!args || args.length === 0) return []
  if (args.length === 1 && Array.isArray(args[0])) {
    return args[0].flat().filter((k) => k != null && k !== '')
  }
  return args.flat().filter((k) => k != null && k !== '')
}

redisClient.del = async function delWithMetrics(...args) {
  const keyList = normalizeDelKeyArgs(args)
  const startTime = Date.now()

  try {
    if (keyList.length === 0) return 0
    const result = await originalDel(keyList)
    const elapsed = Date.now() - startTime
    incrementCommand('del', elapsed)
    if (elapsed > 100) {
      const preview = keyList.length > 3
        ? `${keyList.slice(0, 3).join(',')}...(${keyList.length} keys)`
        : keyList.join(',')
      logger.warn('Redis 慢查询 DEL', { ms: elapsed, keys: preview })
    }
    return result
  } catch (error) {
    incrementErrors()
    logger.error('Redis DEL 错误', { keyCount: keyList.length, err: error?.message || error })
    throw error
  }
}

const SCAN_COUNT_DEFAULT = Math.min(
  1000,
  Math.max(50, parseInt(process.env.REDIS_SCAN_COUNT || '200', 10) || 200),
)

redisClient.scanDelByPattern = async function scanDelByPattern(pattern, options = {}) {
  const COUNT = options.COUNT || SCAN_COUNT_DEFAULT
  let cursor = '0'
  let deleted = 0
  try {
    do {
      const reply = await redisClient.scan(cursor, { MATCH: pattern, COUNT })
      incrementCommand('scan')
      cursor = String(reply.cursor)
      const keys = reply.keys || []
      if (keys.length) {
        await redisClient.del(keys)
        deleted += keys.length
      }
    } while (cursor !== '0')
  } catch (error) {
    incrementErrors()
    logger.error('Redis scanDelByPattern 失败', { pattern, err: error?.message || error })
    if (!options.swallowError) throw error
  }
  return deleted
}

/**
 * 原子 SET key value NX EX — 成功返回 true（首次写入），失败返回 false（已存在）
 */
redisClient.setNxEx = async function setNxEx(key, ttlSec, value = '1') {
  const ttl = parseInt(ttlSec, 10)
  if (!key || Number.isNaN(ttl) || ttl <= 0) return false
  const result = await redisClient.set(key, value, { NX: true, EX: ttl })
  return result === 'OK'
}

/**
 * 读缓存降级：Redis 不可用时返回 null，不抛错
 * 成功读计入 GET 指标（含 cache_hit_rate）；失败只记 safeGetFallbacks，不抬高 errors
 */
redisClient.safeGet = async function safeGet(key) {
  try {
    if (!redisClient.isOpen) await redisClient.connect()
    const startTime = Date.now()
    const result = await originalGet(key)
    const elapsed = Date.now() - startTime
    incrementCommand('get', elapsed)
    recordGetOutcome(key, Boolean(result))
    if (elapsed > 100) logger.warn('Redis 慢查询 GET', { ms: elapsed, key })
    return result
  } catch (error) {
    forEachMetricsBucket((bucket) => {
      bucket.safeGetFallbacks += 1
    })
    logger.warn('Redis safeGet 失败，降级为 miss', { key, err: error?.message || error })
    return null
  }
}

function createRedisUnavailableError(message = 'Redis 暂不可用') {
  const err = new Error(message)
  err.code = 'REDIS_UNAVAILABLE'
  return err
}

/**
 * 关键路径（锁、报价、幂等）调用前检查 Redis 可用性
 */
async function assertRedisOperational() {
  const health = await checkRedisHealth()
  if (!health.ok) {
    throw createRedisUnavailableError(health.error || 'Redis 暂不可用')
  }
  return true
}

redisClient.assertRedisOperational = assertRedisOperational
redisClient.createRedisUnavailableError = createRedisUnavailableError

function replaceMetricsBucket(target, source) {
  Object.assign(target, source)
  target.commandCounts = { ...source.commandCounts }
  target.responseTimes = [...(source.responseTimes || [])]
}

redisClient.getMetrics = function getMetrics() {
  const windowSnapshot = buildRedisMetricsSnapshot(redisMetrics.window)
  const lifetimeSnapshot = buildRedisMetricsSnapshot(redisMetrics.lifetime)
  return {
    ...windowSnapshot,
    scope: 'window',
    lifetime: lifetimeSnapshot,
  }
}

redisClient.resetWindowMetrics = function resetWindowMetrics() {
  replaceMetricsBucket(redisMetrics.window, createEmptyRedisMetrics())
}

redisClient.resetMetrics = function resetMetrics() {
  replaceMetricsBucket(redisMetrics.window, createEmptyRedisMetrics())
  replaceMetricsBucket(redisMetrics.lifetime, createEmptyRedisMetrics())
}

const zsetMethods = ['zAdd', 'zRem', 'zRemRangeByScore', 'zRangeByScore']
for (const methodName of zsetMethods) {
  if (typeof redisClient[methodName] !== 'function') continue
  const original = redisClient[methodName].bind(redisClient)
  redisClient[methodName] = async function zsetWithMetrics(...args) {
    incrementCommand('zset')
    return original(...args)
  }
}

if (process.env.NODE_ENV !== 'test' && METRICS_LOG_INTERVAL_MS > 0) {
  setInterval(() => {
    logger.info('Redis 性能统计', redisClient.getMetrics())
    redisClient.resetWindowMetrics()
  }, METRICS_LOG_INTERVAL_MS)
}

async function checkRedisHealth() {
  try {
    if (!redisClient.isOpen) await redisClient.connect()
    const start = Date.now()
    await redisClient.ping()
    return { ok: true, latency_ms: Date.now() - start }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

redisClient.checkRedisHealth = checkRedisHealth

async function shutdownRedis() {
  if (!redisClient.isOpen) return
  try {
    await redisClient.quit()
  } catch (err) {
    logger.warn('Redis quit 失败', { err: err?.message || err })
  }
}

redisClient.shutdownRedis = shutdownRedis

if (process.env.NODE_ENV !== 'test') {
  redisClient.connect().catch((err) => {
    logger.error('Redis 初始连接失败', { err: err?.message || err })
  })
}

module.exports = redisClient
