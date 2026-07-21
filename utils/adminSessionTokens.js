const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { query } = require('../db')
const { JWT_SECRET } = require('./sessionAuth')
const { hashSessionToken } = require('./sessionTokenHash')
const { ensureAdminRefreshTokensSchema } = require('./adminRefreshTokensSchema')

const ADMIN_ACCESS_TOKEN_EXPIRES_IN = process.env.ADMIN_ACCESS_TOKEN_EXPIRES_IN || '24h'
const ADMIN_REFRESH_TOKEN_TTL_DAYS = Math.max(
  1,
  Math.min(parseInt(process.env.ADMIN_REFRESH_TOKEN_TTL_DAYS || '30', 10) || 30, 365)
)

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateRefreshToken() {
  return crypto.randomBytes(32).toString('base64url')
}

function signAdminAccessToken(userId) {
  return jwt.sign(
    { userId, jti: crypto.randomUUID() },
    JWT_SECRET,
    { expiresIn: ADMIN_ACCESS_TOKEN_EXPIRES_IN }
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
  expiresAtDate.setDate(expiresAtDate.getDate() + ADMIN_REFRESH_TOKEN_TTL_DAYS)
  const expiresAt = expiresAtDate.toISOString()
  const expiresIn = Math.max(0, Math.floor((expiresAtDate.getTime() - Date.now()) / 1000))
  return { expiresAt, expiresIn }
}

async function persistAdminAccessSession({ userId, accessToken, connection = null }) {
  const decoded = jwt.decode(accessToken)
  const expiresAt = new Date(decoded.exp * 1000)
  const tokenHash = hashSessionToken(accessToken)
  const runner = connection && typeof connection.query === 'function' ? connection : null
  const sql =
    'INSERT INTO user_sessions (user_id, token, token_hash, expires_at) VALUES (?, ?, ?, ?)'
  const params = [userId, accessToken, tokenHash, expiresAt]
  if (runner) {
    await runner.query(sql, params)
    return
  }
  await query(sql, params)
}

async function createRefreshTokenRecord({ userId, connection = null }) {
  await ensureAdminRefreshTokensSchema()
  const refreshToken = generateRefreshToken()
  const tokenHash = hashRefreshToken(refreshToken)
  const { expiresAt, expiresIn } = getRefreshTokenMeta()
  const runner = connection && typeof connection.query === 'function' ? connection : null
  const sql =
    'INSERT INTO user_refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))'
  const params = [userId, tokenHash, ADMIN_REFRESH_TOKEN_TTL_DAYS]
  if (runner) await runner.query(sql, params)
  else await query(sql, params)

  return {
    refreshToken,
    refresh_expires_at: expiresAt,
    refreshExpiresIn: expiresIn,
  }
}

async function issueAdminTokenPair({ userId, connection = null }, attempt = 0) {
  const token = signAdminAccessToken(userId)
  const { expiresAt, expiresIn } = getAccessTokenMeta(token)

  try {
    await persistAdminAccessSession({ userId, accessToken: token, connection })
  } catch (err) {
    if (isDuplicateSessionError(err) && attempt < 2) {
      return issueAdminTokenPair({ userId, connection }, attempt + 1)
    }
    throw err
  }

  const refresh = await createRefreshTokenRecord({ userId, connection })

  return {
    token,
    expires_at: expiresAt,
    expiresIn,
    refreshToken: refresh.refreshToken,
    refresh_expires_at: refresh.refresh_expires_at,
    refreshExpiresIn: refresh.refreshExpiresIn,
  }
}

async function refreshAdminAccessToken(refreshToken) {
  await ensureAdminRefreshTokensSchema()

  if (!refreshToken || typeof refreshToken !== 'string' || refreshToken.trim().length === 0) {
    return { ok: false, status: 400, error: '缺少 refreshToken' }
  }

  const tokenHash = hashRefreshToken(refreshToken.trim())
  const [rows] = await query(
    `SELECT id, user_id FROM user_refresh_tokens
     WHERE token_hash = ? AND expires_at > NOW() AND revoked_at IS NULL
     LIMIT 1`,
    [tokenHash]
  )

  if (!rows || rows.length === 0) {
    return { ok: false, status: 401, error: 'refreshToken 无效或已过期' }
  }

  const record = rows[0]
  const [users] = await query(
    `SELECT u.id, u.status
     FROM users u
     WHERE u.id = ?
     LIMIT 1`,
    [record.user_id]
  )
  if (!users || users.length === 0) {
    return { ok: false, status: 401, error: '用户不存在' }
  }
  if (users[0].status !== 'active') {
    return { ok: false, status: 403, error: '账户已被禁用' }
  }

  await query('UPDATE user_refresh_tokens SET revoked_at = NOW() WHERE id = ?', [record.id])

  const pair = await issueAdminTokenPair({ userId: users[0].id })
  return { ok: true, ...pair }
}

async function revokeAdminRefreshTokensForUser(userId, connection = null) {
  if (!userId) return
  await ensureAdminRefreshTokensSchema()
  const runner = connection && typeof connection.query === 'function' ? connection : null
  const sql =
    'UPDATE user_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL'
  if (runner) {
    await runner.query(sql, [userId])
    return
  }
  await query(sql, [userId])
}

async function revokeAdminAccessSession(token) {
  if (!token) return
  const tokenHash = hashSessionToken(token)
  await query(
    'DELETE FROM user_sessions WHERE token = ? OR token_hash = ?',
    [token, tokenHash]
  )
}

module.exports = {
  ADMIN_ACCESS_TOKEN_EXPIRES_IN,
  ADMIN_REFRESH_TOKEN_TTL_DAYS,
  issueAdminTokenPair,
  refreshAdminAccessToken,
  revokeAdminRefreshTokensForUser,
  revokeAdminAccessSession,
  getAccessTokenMeta,
}
