const { applyCorsHeaders } = require('./corsPolicy')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const {
  loadApiSignClientsFromEnv,
  verifyApiRequestSignature,
  shouldSkipApiSign,
  buildApiSignNonceRedisKey,
  resolveRequestBodyForSign,
  getApiSignClockSkewSec,
  getApiSignNonceTtlSec,
  isApiSignEnabled,
  getApiSignEnforceMode,
  shouldEnforceApiSignForMethod,
  isApiSignStrictRedis,
} = require('../utils/apiRequestSign')

function respondSignError(req, res, status, payload) {
  applyCorsHeaders(req, res)
  return res.status(status).json({
    ...payload,
    request_id: req.requestId || null,
  })
}

function resolveSignPath(req) {
  const base = String(req?.baseUrl || '')
  const path = String(req?.path || '/')
  const combined = `${base}${path}`.split('?')[0] || '/'
  return combined.startsWith('/') ? combined : `/${combined}`
}

function resolveEnforceMode(deps = {}) {
  if (deps.enforceMode) return deps.enforceMode
  if (deps.enforced === true) return 'all'
  if (deps.enforceWrites === true) return 'writes'
  return getApiSignEnforceMode()
}

async function registerApiSignNonce({ redis, apiKey, nonce, ttlSec }) {
  const key = buildApiSignNonceRedisKey(apiKey, nonce)
  try {
    const registered = await redis.setNxEx(key, ttlSec)
    return { ok: true, replay: !registered }
  } catch (error) {
    return { ok: false, redisUnavailable: true, error }
  }
}

function createApiRequestSignMiddleware(deps = {}) {
  const redis = deps.redis || redisClient
  const clients = deps.clients || loadApiSignClientsFromEnv()
  const enabled = deps.enabled ?? isApiSignEnabled()
  const enforceMode = resolveEnforceMode(deps)
  const strictRedis = deps.strictRedis ?? isApiSignStrictRedis()
  const clockSkewSec = deps.clockSkewSec ?? getApiSignClockSkewSec()
  const nonceTtlSec = deps.nonceTtlSec ?? getApiSignNonceTtlSec()

  if (enabled && clients.size === 0) {
    logger.warn('api_sign_enabled_without_clients', {
      enforce_mode: enforceMode,
      message:
        'API_SIGN_ENABLED=true 但未加载任何客户端密钥。请在服务器 .env 配置 API_SIGN_SECRET_ADMIN_WEB 与 API_SIGN_SECRET_WX_MINI（或 API_SIGN_CLIENTS）后重启',
      has_api_sign_clients: Boolean(process.env.API_SIGN_CLIENTS),
      has_admin_secret: Boolean(process.env.API_SIGN_SECRET_ADMIN_WEB),
      has_wx_secret: Boolean(process.env.API_SIGN_SECRET_WX_MINI),
    })
  } else if (enabled) {
    logger.info('api_sign_ready', {
      enforce_mode: enforceMode,
      client_ids: [...clients.keys()],
    })
  }

  return async function apiRequestSignMiddleware(req, res, next) {
    if (!enabled) return next()

    const signPath = resolveSignPath(req)
    const requestEnforced = shouldEnforceApiSignForMethod(req.method, enforceMode)

    if (shouldSkipApiSign({ method: req.method, path: signPath })) {
      return next()
    }

    const verifyResult = verifyApiRequestSignature({
      method: req.method,
      path: signPath,
      query: req.query,
      body: resolveRequestBodyForSign(req),
      headers: req.headers,
      clients,
      clockSkewSec,
    })

    if (!verifyResult.ok) {
      const signHeaders = req.headers || {}
      logger.warn('api_sign_verify_failed', {
        code: verifyResult.code,
        path: signPath,
        method: req.method,
        api_key: signHeaders['x-api-key'] || signHeaders['X-Api-Key'] || null,
        request_id: req.requestId || null,
        enforce_mode: enforceMode,
        enforced: requestEnforced,
      })

      if (requestEnforced) {
        return respondSignError(req, res, 401, {
          error: verifyResult.error,
          code: verifyResult.code,
        })
      }

      return next()
    }

    const nonceResult = await registerApiSignNonce({
      redis,
      apiKey: verifyResult.apiKey,
      nonce: verifyResult.nonce,
      ttlSec: nonceTtlSec,
    })

    if (nonceResult.redisUnavailable) {
      logger.warn('api_sign_nonce_redis_unavailable', {
        path: signPath,
        method: req.method,
        request_id: req.requestId || null,
        strictRedis,
        enforce_mode: enforceMode,
        enforced: requestEnforced,
        err: nonceResult.error?.message || String(nonceResult.error),
      })

      // 强制验签或 STRICT_REDIS 时拒绝，避免 nonce 窗口 fail-open
      if (strictRedis || requestEnforced) {
        return respondSignError(req, res, 503, {
          error: '签名服务暂时不可用',
          code: 'SIGN_SERVICE_UNAVAILABLE',
        })
      }

      req.apiSign = {
        apiKey: verifyResult.apiKey,
        nonceSkipped: true,
      }
      return next()
    }

    if (nonceResult.replay) {
      logger.warn('api_sign_replay_detected', {
        path: signPath,
        method: req.method,
        api_key: verifyResult.apiKey,
        request_id: req.requestId || null,
        enforce_mode: enforceMode,
        enforced: requestEnforced,
      })

      if (requestEnforced) {
        return respondSignError(req, res, 401, {
          error: '请求已被使用',
          code: 'REPLAY_DETECTED',
        })
      }

      return next()
    }

    req.apiSign = {
      apiKey: verifyResult.apiKey,
      timestamp: verifyResult.timestamp,
      nonce: verifyResult.nonce,
    }
    return next()
  }
}

const apiRequestSignMiddleware = createApiRequestSignMiddleware()

module.exports = {
  createApiRequestSignMiddleware,
  apiRequestSignMiddleware,
  registerApiSignNonce,
  respondSignError,
  resolveSignPath,
  resolveEnforceMode,
}
