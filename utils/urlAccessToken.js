const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { query } = require('../db')

const URL_ACCESS_TTL_SECONDS = (() => {
  const n = parseInt(String(process.env.URL_ACCESS_TTL_SECONDS || '900'), 10)
  return Number.isFinite(n) && n >= 60 && n <= 3600 ? n : 900
})()

const ALLOWED_PURPOSES = new Set(['webview_proxy'])

function sessionTokenSid(sessionToken) {
  return crypto.createHash('sha256').update(String(sessionToken)).digest('hex').slice(0, 32)
}

function normalizeClaimsForCompare(claims) {
  const out = {}
  for (const [key, value] of Object.entries(claims || {})) {
    if (value === undefined) continue
    out[key] = value
  }
  return out
}

function claimsMatch(decoded, expected) {
  const want = normalizeClaimsForCompare(expected)
  for (const [key, value] of Object.entries(want)) {
    if (decoded[key] !== value) return false
  }
  return true
}

async function isSessionSidActive(userId, sid) {
  const [sessions] = await query(
    'SELECT token FROM user_sessions WHERE user_id = ? AND expires_at > NOW()',
    [userId]
  )
  if (!sessions?.length) return false
  return sessions.some((row) => sessionTokenSid(row.token) === sid)
}

/**
 * 签发仅用于 URL 的短期 access（绑定登录会话 sid，登出即失效）
 */
async function mintUrlAccessToken(sessionToken, { purpose, claims = {} }) {
  if (!ALLOWED_PURPOSES.has(purpose)) {
    return { ok: false, status: 400, error: '不支持的 access 用途' }
  }

  const { verifyActiveSessionToken, JWT_SECRET } = require('./sessionAuth')
  const verified = await verifyActiveSessionToken(sessionToken)
  if (!verified.ok) return verified

  const access = jwt.sign(
    {
      tokenType: 'url_access',
      purpose,
      userId: verified.userId,
      sid: sessionTokenSid(sessionToken),
      ...claims,
    },
    JWT_SECRET,
    { expiresIn: URL_ACCESS_TTL_SECONDS }
  )

  return {
    ok: true,
    access,
    expiresIn: URL_ACCESS_TTL_SECONDS,
    userId: verified.userId,
  }
}

/**
 * 校验 URL access（拒绝 typ 非 url_access 或会话已失效）
 */
async function verifyUrlAccessToken(accessToken, { purpose, claims = {} }) {
  if (!accessToken || typeof accessToken !== 'string') {
    return { ok: false, status: 401, error: '未提供 access' }
  }

  if (!ALLOWED_PURPOSES.has(purpose)) {
    return { ok: false, status: 400, error: '不支持的 access 用途' }
  }

  try {
    const { JWT_SECRET } = require('./sessionAuth')
    const decoded = jwt.verify(accessToken, JWT_SECRET)
    if (decoded.tokenType !== 'url_access') {
      return { ok: false, status: 401, error: '无效的 access' }
    }
    if (decoded.purpose !== purpose) {
      return { ok: false, status: 403, error: 'access 用途不匹配' }
    }
    if (!claimsMatch(decoded, claims)) {
      return { ok: false, status: 403, error: 'access 与请求资源不匹配' }
    }

    const sidActive = await isSessionSidActive(Number(decoded.userId), decoded.sid)
    if (!sidActive) {
      return { ok: false, status: 401, error: '登录已失效，请重新登录' }
    }

    return {
      ok: true,
      userId: Number(decoded.userId),
      claims: decoded,
    }
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { ok: false, status: 401, error: 'access 已过期' }
    }
    if (error.name === 'JsonWebTokenError') {
      return { ok: false, status: 401, error: '无效的 access' }
    }
    throw error
  }
}

module.exports = {
  URL_ACCESS_TTL_SECONDS,
  ALLOWED_PURPOSES,
  mintUrlAccessToken,
  verifyUrlAccessToken,
}
