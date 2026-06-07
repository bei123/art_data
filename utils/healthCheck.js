const db = require('../db')
const redisClient = require('./redisClient')
const logger = require('./logger')

async function runHealthChecks() {
  const [dbHealth, redisHealth] = await Promise.all([
    db.checkPoolHealth(),
    redisClient.checkRedisHealth(),
  ])

  const dbOk = dbHealth.healthy === true
  const redisOk = redisHealth.ok === true

  return {
    ok: dbOk && redisOk,
    dbOk,
    redisOk,
    dbHealth,
    redisHealth,
  }
}

function buildLiveResponse() {
  return { status: 'ok' }
}

/** 对外探活：仅返回聚合状态，不含依赖错误、延迟或拓扑信息 */
function buildPublicReadinessResponse(result) {
  return {
    status: result.ok ? 'ok' : 'degraded',
  }
}

/** 管理端诊断：含各依赖详情（错误信息仅对 admin 暴露） */
function buildDetailedHealthResponse(result, req) {
  const { dbHealth, redisHealth, dbOk, redisOk } = result

  return {
    status: result.ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    request_id: req.requestId || null,
    checks: {
      database: {
        healthy: dbOk,
        ...(dbHealth.error ? { error: dbHealth.error } : {}),
      },
      redis: redisOk
        ? {
            ok: true,
            ...(redisHealth.latency_ms != null
              ? { latency_ms: redisHealth.latency_ms }
              : {}),
          }
        : {
            ok: false,
            ...(redisHealth.error ? { error: redisHealth.error } : {}),
          },
    },
  }
}

function logDegradedHealth(result) {
  if (result.ok) return

  logger.warn('health_check_degraded', {
    database: {
      healthy: result.dbOk,
      ...(result.dbHealth.error ? { error: result.dbHealth.error } : {}),
    },
    redis: {
      ok: result.redisOk,
      ...(result.redisHealth.error ? { error: result.redisHealth.error } : {}),
    },
  })
}

module.exports = {
  runHealthChecks,
  buildLiveResponse,
  buildPublicReadinessResponse,
  buildDetailedHealthResponse,
  logDegradedHealth,
}
