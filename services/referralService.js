const crypto = require('crypto')
const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralSchema } = require('../utils/referralSchema')
const {
  getUserTierProfile,
  isRecommenderOrAbove,
} = require('./userTierService')

const REFERRAL_BINDING_DAYS = parseInt(process.env.REFERRAL_BINDING_DAYS || '365', 10)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
const VALID_BIND_SOURCES = new Set(['link', 'code', 'poster'])
const VALID_SHARE_CHANNELS = new Set(['link', 'poster', 'miniprogram'])
const VALID_SHARE_ITEM_TYPES = new Set(['right', 'artwork', 'digital'])

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function normalizeReferrerCode(raw) {
  if (raw === undefined || raw === null) return null
  const code = String(raw).trim().toUpperCase()
  if (!code) return null
  if (code.length > 16 || !/^[A-Z0-9]+$/.test(code)) return null
  return code
}

function parseReferrerId(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const id = parseInt(raw, 10)
  if (Number.isNaN(id) || id <= 0) return null
  return id
}

function normalizeBindSource(raw) {
  const source = String(raw || 'link').trim().toLowerCase()
  if (!VALID_BIND_SOURCES.has(source)) return null
  return source
}

function randomReferralCode() {
  const bytes = crypto.randomBytes(CODE_LENGTH)
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += CODE_CHARS[bytes[i] % CODE_CHARS.length]
  }
  return code
}

function computeBindingExpiresAt(fromDate = new Date()) {
  const expires = new Date(fromDate)
  expires.setDate(expires.getDate() + REFERRAL_BINDING_DAYS)
  return expires
}

function isBindingActive(binding, now = new Date()) {
  if (!binding) return false
  return new Date(binding.expires_at) > now
}

async function ensureReferralCode(userId, connection = db) {
  await ensureReferralSchema()

  const [existing] = await connection.query(
    'SELECT code, status FROM referral_codes WHERE user_id = ? LIMIT 1',
    [userId]
  )
  if (existing.length > 0) {
    return existing[0].code
  }

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = randomReferralCode()
    try {
      await connection.query(
        'INSERT INTO referral_codes (user_id, code, status) VALUES (?, ?, ?)',
        [userId, code, 'active']
      )
      return code
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY') continue
      throw err
    }
  }

  throw new Error('无法生成唯一推荐码')
}

async function getReferralCodeRowByUserId(userId, connection = db) {
  const [rows] = await connection.query(
    'SELECT user_id, code, status, created_at FROM referral_codes WHERE user_id = ? LIMIT 1',
    [userId]
  )
  return rows[0] || null
}

async function getReferralCodeRowByCode(code, connection = db) {
  const [rows] = await connection.query(
    `SELECT rc.user_id, rc.code, rc.status, rc.created_at, wu.user_tier
     FROM referral_codes rc
     JOIN wx_users wu ON wu.id = rc.user_id
     WHERE rc.code = ? AND rc.status = 'active'
     LIMIT 1`,
    [code]
  )
  return rows[0] || null
}

async function getBindingByRefereeId(refereeId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id, referrer_id, referee_id, source, bound_at, expires_at
     FROM referral_bindings
     WHERE referee_id = ?
     LIMIT 1`,
    [refereeId]
  )
  return rows[0] || null
}

async function resolveReferrerId({ code, referrerId }, connection = db) {
  const normalizedCode = normalizeReferrerCode(code)
  if (normalizedCode) {
    const row = await getReferralCodeRowByCode(normalizedCode, connection)
    return row ? row.user_id : null
  }

  const parsedId = parseReferrerId(referrerId)
  if (!parsedId) return null

  const [users] = await connection.query('SELECT id FROM wx_users WHERE id = ? LIMIT 1', [parsedId])
  return users.length > 0 ? parsedId : null
}

async function bindReferral({ refereeId, code, referrerId, source = 'link', connection = db }) {
  await ensureReferralSchema()

  const normalizedSource = normalizeBindSource(source)
  if (!normalizedSource) {
    return { ok: false, status: 400, error: '无效的绑定来源' }
  }

  if (!refereeId || refereeId <= 0) {
    return { ok: false, status: 400, error: '无效的被推荐用户' }
  }

  const resolvedReferrerId = await resolveReferrerId({ code, referrerId }, connection)
  if (!resolvedReferrerId) {
    return { ok: false, status: 400, error: '推荐码或推荐人无效' }
  }

  if (resolvedReferrerId === refereeId) {
    return { ok: false, status: 400, error: '不能绑定自己为推荐人' }
  }

  const [refereeRows] = await connection.query('SELECT id FROM wx_users WHERE id = ? LIMIT 1', [refereeId])
  if (!refereeRows.length) {
    return { ok: false, status: 404, error: '用户不存在' }
  }

  const existingBinding = await getBindingByRefereeId(refereeId, connection)
  if (existingBinding) {
    return {
      ok: false,
      status: 409,
      error: '已绑定推荐关系，不可修改',
      binding: formatBinding(existingBinding),
    }
  }

  const expiresAt = computeBindingExpiresAt()

  await connection.query(
    `INSERT INTO referral_bindings (referrer_id, referee_id, source, expires_at)
     VALUES (?, ?, ?, ?)`,
    [resolvedReferrerId, refereeId, normalizedSource, expiresAt]
  )

  const binding = await getBindingByRefereeId(refereeId, connection)

  logger.info('referral binding created', {
    refereeId,
    referrerId: resolvedReferrerId,
    source: normalizedSource,
  })

  return {
    ok: true,
    status: 200,
    binding: formatBinding(binding),
  }
}

function formatBinding(binding) {
  if (!binding) return null
  return {
    referrer_id: binding.referrer_id,
    referee_id: binding.referee_id,
    source: binding.source,
    bound_at: binding.bound_at,
    expires_at: binding.expires_at,
    is_active: isBindingActive(binding),
  }
}

async function resolveOrderReferrerId(refereeId, connection = db) {
  const binding = await getBindingByRefereeId(refereeId, connection)
  if (!isBindingActive(binding)) return null
  return binding.referrer_id
}

async function resolveDisplayReferralCode(userId, tier) {
  if (isRecommenderOrAbove(tier)) {
    return ensureReferralCode(userId)
  }
  const row = await getReferralCodeRowByUserId(userId)
  return row?.status === 'active' ? row.code : null
}

async function getReferralCodeInfo(userId) {
  await ensureReferralSchema()

  const tierProfile = await getUserTierProfile(userId)
  if (!tierProfile) {
    return adminResult(404, { error: '用户不存在' })
  }

  const code = await resolveDisplayReferralCode(userId, tierProfile.tier)

  return adminResult(200, {
    tier: tierProfile,
    referral_code: code,
    share_query: code ? `referrerCode=${code}` : null,
    referrer_id: userId,
    binding_days: REFERRAL_BINDING_DAYS,
  })
}

async function getReferralCenter(userId) {
  await ensureReferralSchema()

  const tierProfile = await getUserTierProfile(userId)
  if (!tierProfile) {
    return adminResult(404, { error: '用户不存在' })
  }

  const binding = await getBindingByRefereeId(userId)
  const codeRow = await getReferralCodeRowByUserId(userId)

  const [orderStats] = await db.query(
    `SELECT COUNT(*) AS referred_order_count
     FROM orders
     WHERE referrer_id = ? AND trade_state = 'SUCCESS'`,
    [userId]
  )

  const [shareStats] = await db.query(
    'SELECT COUNT(*) AS share_count FROM share_events WHERE user_id = ?',
    [userId]
  )

  return adminResult(200, {
    tier: tierProfile,
    referral_code: codeRow?.status === 'active' ? codeRow.code : null,
    my_binding: formatBinding(binding),
    stats: {
      referred_order_count: Number(orderStats[0]?.referred_order_count || 0),
      share_count: Number(shareStats[0]?.share_count || 0),
      pending_commission_yuan: 0,
      available_commission_yuan: 0,
      withdrawn_commission_yuan: 0,
    },
  })
}

async function recordShareEvent(userId, body) {
  await ensureReferralSchema()

  const itemType = String(body?.item_type || '').trim()
  const itemId = String(body?.item_id || '').trim()
  const channel = String(body?.channel || 'miniprogram').trim().toLowerCase()

  if (!VALID_SHARE_ITEM_TYPES.has(itemType)) {
    return adminResult(400, { error: '无效的作品类型' })
  }
  if (!itemId || itemId.length > 64) {
    return adminResult(400, { error: '无效的作品ID' })
  }
  if (!VALID_SHARE_CHANNELS.has(channel)) {
    return adminResult(400, { error: '无效的分享渠道' })
  }

  await db.query(
    'INSERT INTO share_events (user_id, item_type, item_id, channel) VALUES (?, ?, ?, ?)',
    [userId, itemType, itemId, channel]
  )

  return adminResult(200, { success: true })
}

async function bindReferralFromRequest(req) {
  const session = await resolveWxUserId(req)
  if (!session.ok) return session.result

  const { referrerCode, referrerId, source } = req.body || {}
  const result = await bindReferral({
    refereeId: session.userId,
    code: referrerCode,
    referrerId,
    source,
  })

  if (!result.ok) {
    return adminResult(result.status, {
      error: result.error,
      binding: result.binding || undefined,
    })
  }

  return adminResult(200, {
    success: true,
    binding: result.binding,
  })
}

async function tryBindReferralOnLogin(userId, body) {
  const { referrerCode, referrerId, source } = body || {}
  const hasReferrerInput = normalizeReferrerCode(referrerCode) || parseReferrerId(referrerId)
  if (!hasReferrerInput) {
    return { attempted: false }
  }

  const result = await bindReferral({
    refereeId: userId,
    code: referrerCode,
    referrerId,
    source: source || 'link',
  })

  return {
    attempted: true,
    success: result.ok,
    status: result.status,
    error: result.error || null,
    binding: result.binding || null,
  }
}

async function resolveWxUserId(req) {
  const { resolveAuthFromRequest } = require('../auth')
  const auth = await resolveAuthFromRequest(req)
  if (!auth.ok) {
    return { ok: false, result: adminResult(auth.status, { error: auth.error }) }
  }
  if (!auth.user?.is_wx_user) {
    return { ok: false, result: adminResult(403, { error: '仅微信用户可访问' }) }
  }
  return { ok: true, userId: auth.user.id }
}

async function getTierForRequest(req) {
  const session = await resolveWxUserId(req)
  if (!session.ok) return session.result

  const profile = await getUserTierProfile(session.userId)
  if (!profile) {
    return adminResult(404, { error: '用户不存在' })
  }

  return adminResult(200, { tier: profile })
}

module.exports = {
  adminResult,
  REFERRAL_BINDING_DAYS,
  normalizeReferrerCode,
  parseReferrerId,
  normalizeBindSource,
  computeBindingExpiresAt,
  isBindingActive,
  ensureReferralCode,
  bindReferral,
  resolveOrderReferrerId,
  getReferralCodeInfo,
  getReferralCenter,
  recordShareEvent,
  bindReferralFromRequest,
  tryBindReferralOnLogin,
  getTierForRequest,
  resolveWxUserId,
  getBindingByRefereeId,
  formatBinding,
}
