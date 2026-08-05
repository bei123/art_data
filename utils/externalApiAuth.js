/**
 * Wespace / 外部 API 凭据：仅从请求头或环境变量读取，禁止源码内硬编码 fallback。
 * 带 req 的用户态调用默认不回落到服务端 env，避免 Bearer JWT 路由静默使用平台账号。
 */

function resolveWespaceBasicAuthorization(req, options = {}) {
  const allowEnvFallback = options.allowEnvFallback !== false && !req

  if (req) {
    const fromDedicated =
      req.headers?.['x-external-authorization'] || req.headers?.['X-External-Authorization']
    if (fromDedicated && String(fromDedicated).trim()) {
      return String(fromDedicated).trim()
    }

    const auth = req.headers?.authorization || req.headers?.Authorization
    if (auth && String(auth).startsWith('Basic ')) {
      return String(auth).trim()
    }

    // 用户请求：除非显式 allowEnvFallback，否则不使用服务端 env
    if (options.allowEnvFallback === true) {
      const fromEnv = process.env.VERIFICATION_CODE_AUTHORIZATION
      if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
    }
    return null
  }

  if (allowEnvFallback || options.allowEnvFallback === true) {
    const fromEnv = process.env.VERIFICATION_CODE_AUTHORIZATION
    if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
  }

  return null
}

function resolveExternalBearerAuthorization() {
  const raw = process.env.EXTERNAL_BEARER_TOKEN
  if (!raw || !String(raw).trim()) return null
  const token = String(raw).trim()
  return token.startsWith('Bearer ') ? token : `Bearer ${token}`
}

function externalAuthNotConfiguredBody(message = '外部 API 凭据未配置') {
  return { code: 503, status: false, message }
}

module.exports = {
  resolveWespaceBasicAuthorization,
  resolveExternalBearerAuthorization,
  externalAuthNotConfiguredBody,
}
