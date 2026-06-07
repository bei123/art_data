import { describe, it, expect } from 'vitest'
import {
  buildLiveResponse,
  buildPublicReadinessResponse,
  buildDetailedHealthResponse,
} from '../utils/healthCheck.js'

describe('healthCheck responses', () => {
  it('live probe returns minimal payload', () => {
    expect(buildLiveResponse()).toEqual({ status: 'ok' })
  })

  it('public readiness omits internal check details', () => {
    const result = {
      ok: false,
      dbOk: false,
      redisOk: true,
      dbHealth: { healthy: false, error: 'ECONNREFUSED 127.0.0.1:3306' },
      redisHealth: { ok: true, latency_ms: 3 },
    }

    expect(buildPublicReadinessResponse(result)).toEqual({ status: 'degraded' })
  })

  it('detailed readiness includes dependency errors for admin', () => {
    const result = {
      ok: false,
      dbOk: false,
      redisOk: true,
      dbHealth: { healthy: false, error: '连接池已关闭' },
      redisHealth: { ok: true, latency_ms: 5 },
    }

    const body = buildDetailedHealthResponse(result, { requestId: 'req-1' })
    expect(body.checks.database.error).toBe('连接池已关闭')
    expect(body.checks.redis.latency_ms).toBe(5)
    expect(body.request_id).toBe('req-1')
  })
})
