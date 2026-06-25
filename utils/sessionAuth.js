const jwt = require('jsonwebtoken')
const { query } = require('../db')
const { hashSessionToken } = require('./sessionTokenHash')

const isTestRuntime = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'
const JWT_SECRET = process.env.JWT_SECRET
  || (isTestRuntime ? 'vitest-jwt-secret-at-least-32-characters' : null)

if (!JWT_SECRET) {
  console.error('错误: 缺少必要的环境变量 JWT_SECRET')
  process.exit(1)
}

function extractBearerToken(authHeader) {
  if (!authHeader || typeof authHeader !== 'string') return null
  const parts = authHeader.trim().split(/\s+/)
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null
  return parts[1] || null
}

/**
 * 校验 JWT 且在会话表中仍有效（登出/过期即失效）
 * 微信用户（JWT 含 openid）查 wx_user_sessions；后台用户查 user_sessions
 */
function resolveSessionTable(decoded) {
  return decoded?.openid ? 'wx_user_sessions' : 'user_sessions'
}

async function verifyActiveSessionToken(token) {
  if (!token || typeof token !== 'string') {
    return { ok: false, status: 401, error: '未登录' }
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET)
    const sessionTable = resolveSessionTable(decoded)

    const tokenHash = hashSessionToken(token)
    const [sessions] = await query(
      `SELECT user_id FROM ${sessionTable}
       WHERE expires_at > NOW() AND (token = ? OR token_hash = ?)
       LIMIT 1`,
      [token, tokenHash]
    )

    if (!sessions || sessions.length === 0) {
      return { ok: false, status: 401, error: '登录已失效，请重新登录' }
    }

    if (Number(sessions[0].user_id) !== Number(decoded.userId)) {
      return { ok: false, status: 403, error: '无效的token' }
    }

    return {
      ok: true,
      userId: Number(decoded.userId),
      openid: decoded.openid,
      token,
    }
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return { ok: false, status: 401, error: '登录已过期，请重新登录' }
    }
    if (error.name === 'JsonWebTokenError') {
      return { ok: false, status: 401, error: 'token无效' }
    }
    throw error
  }
}

async function resolveAuthFromRequest(req) {
  const authHeader = req.headers?.authorization || req.headers?.Authorization
  const token = extractBearerToken(authHeader)
  if (!token) {
    return { ok: false, status: 401, error: '未登录' }
  }
  return verifyActiveSessionToken(token)
}

module.exports = {
  JWT_SECRET,
  extractBearerToken,
  resolveSessionTable,
  verifyActiveSessionToken,
  resolveAuthFromRequest,
}
