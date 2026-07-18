const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { query } = require('../db')
const { JWT_SECRET } = require('./sessionAuth')
const { hashSessionToken } = require('./sessionTokenHash')

const WX_ACCESS_TOKEN_EXPIRES_IN = process.env.WX_ACCESS_TOKEN_EXPIRES_IN || '2h'
const WX_REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.WX_REFRESH_TOKEN_TTL_DAYS || '30', 10)

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function signWxAccessToken({ userId, openid }) {
  return jwt.sign(
    { userId, openid, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: WX_ACCESS_TOKEN_EXPIRES_IN }
  )
}

function isDuplicateSessionError(err) {
  if (!err || err.code !== 'ER_DUP_ENTRY') return false
  const message = String(err.message || '')
  return message.includes('uk_token') || message.includes('token_hash')
}

function getAccessTokenMeta(token) {
  const decoded = jwt.decode(token)
  if (!decoded?.exp) {
    throw new Error('invalid access token payload')
  }
  const expiresAt = new Date(decoded.exp * 1000).toISOString()
  const expiresIn = decoded.exp - Math.floor(Date.now() / 1000)
  return { expiresAt, expiresIn }
}

function getRefreshTokenMeta() {
  const expiresAtDate = new Date()
  expiresAtDate.setDate(expiresAtDate.getDate() + WX_REFRESH_TOKEN_TTL_DAYS)
  const expiresAt = expiresAtDate.toISOString()
  const expiresIn = Math.max(0, Math.floor((expiresAtDate.getTime() - Date.now()) / 1000))
  return { expiresAt, expiresIn }
}

async function persistWxAccessSession({ userId, accessToken }) {
  const decoded = jwt.decode(accessToken)
  const expiresAt = new Date(decoded.exp * 1000)
  const tokenHash = hashSessionToken(accessToken)
  await query(
    'INSERT INTO wx_user_sessions (user_id, token, token_hash, expires_at) VALUES (?, ?, ?, ?)',
    [userId, accessToken, tokenHash, expiresAt]
  )
}

async function createRefreshTokenRecord({ userId }) {
  const refreshToken = generateRefreshToken()
  const tokenHash = hashRefreshToken(refreshToken)
  const { expiresAt, expiresIn } = getRefreshTokenMeta()

  await query(
    'INSERT INTO wx_refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))',
    [userId, tokenHash, WX_REFRESH_TOKEN_TTL_DAYS]
  )

  return {
    refreshToken,
    refresh_expires_at: expiresAt,
    refreshExpiresIn: expiresIn,
  }
}

async function issueWxTokenPair({ userId, openid }, attempt = 0) {
  const token = signWxAccessToken({ userId, openid })
  const { expiresAt, expiresIn } = getAccessTokenMeta(token)

  try {
    await persistWxAccessSession({ userId, accessToken: token })
  } catch (err) {
    if (isDuplicateSessionError(err) && attempt < 2) {
      return issueWxTokenPair({ userId, openid }, attempt + 1)
    }
    throw err
  }

  const refresh = await createRefreshTokenRecord({ userId })

  return {
    token,
    expires_at: expiresAt,
    expiresIn,
    refreshToken: refresh.refreshToken,
    refresh_expires_at: refresh.refresh_expires_at,
    refreshExpiresIn: refresh.refreshExpiresIn,
  }
}

async function refreshWxAccessToken(refreshToken) {
  if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    return { ok: false, status: 400, error: '缺少 refreshToken' }
  }

  const tokenHash = hashRefreshToken(refreshToken.trim())
  const [rows] = await query(
    `SELECT id, user_id FROM wx_refresh_tokens
     WHERE token_hash = ? AND expires_at > NOW() AND revoked_at IS NULL
     LIMIT 1`,
    [tokenHash]
  )

  if (!rows || rows.length === 0) {
    return { ok: false, status: 401, error: 'refreshToken 无效或已过期' }
  }

  const record = rows[0]
  const [users] = await query('SELECT id, openid FROM wx_users WHERE id = ? LIMIT 1', [record.user_id])
  if (!users || users.length === 0) {
    return { ok: false, status: 401, error: '用户不存在' }
  }

  await query('UPDATE wx_refresh_tokens SET revoked_at = NOW() WHERE id = ?', [record.id])

  const pair = await issueWxTokenPair({
    userId: users[0].id,
    openid: users[0].openid,
  })

  return { ok: true, ...pair }
}

async function revokeWxRefreshTokensForUser(userId, connection = null) {
  if (!userId) return
  const runner = connection && typeof connection.query === 'function' ? connection : null
  const sql =
    'UPDATE wx_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL'
  if (runner) {
    await runner.query(sql, [userId])
    return
  }
  await query(sql, [userId])
}

/** 注销/踢下线：删除全部 access 会话并吊销 refresh */
async function revokeAllWxAuthForUser(userId, connection = null) {
  if (!userId) return { sessions: 0, refresh: 0 }
  const runner = connection && typeof connection.query === 'function' ? connection : null
  const exec = async (sql, params) => {
    if (runner) return runner.query(sql, params)
    return query(sql, params)
  }

  const [sessionResult] = await exec('DELETE FROM wx_user_sessions WHERE user_id = ?', [userId])
  await revokeWxRefreshTokensForUser(userId, runner || undefined)
  const [refreshResult] = await exec(
    'DELETE FROM wx_refresh_tokens WHERE user_id = ?',
    [userId]
  )

  return {
    sessions: sessionResult?.affectedRows || 0,
    refresh: refreshResult?.affectedRows || 0,
  }
}

async function revokeWxAccessSession(token) {
  if (!token) return
  const tokenHash = hashSessionToken(token)
  await query(
    'DELETE FROM wx_user_sessions WHERE token = ? OR token_hash = ?',
    [token, tokenHash]
  )
}

module.exports = {
  WX_ACCESS_TOKEN_EXPIRES_IN,
  WX_REFRESH_TOKEN_TTL_DAYS,
  hashRefreshToken,
  generateRefreshToken,
  signWxAccessToken,
  getAccessTokenMeta,
  getRefreshTokenMeta,
  issueWxTokenPair,
  refreshWxAccessToken,
  revokeWxRefreshTokensForUser,
  revokeAllWxAuthForUser,
  revokeWxAccessSession,
}
