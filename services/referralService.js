const crypto = require('crypto')
const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralSchema } = require('../utils/referralSchema')
const {
  getUserTierProfile,
  isRecommenderOrAbove,
} = require('./userTierService')
const { getWalletSummary } = require('./commissionService')
const { getWithdrawPolicy } = require('./withdrawService')
const { FIRST_REFERRAL_BONUS_YUAN, NEW_USER_COUPON_YUAN } = require('./referralRewardService')

const REFERRAL_BINDING_DAYS = null // 永久绑定；保留导出名兼容旧调用
/** 分享成交临时归因有效天数（默认 15） */
const REFERRAL_ATTRIBUTION_DAYS = Math.max(
  1,
  Math.min(parseInt(process.env.REFERRAL_ATTRIBUTION_DAYS || '15', 10) || 15, 90),
)
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
  // Unbiased selection: reject bytes in the biased remainder of 256 % alphabetSize.
  const alphabetSize = CODE_CHARS.length
  const limit = 256 - (256 % alphabetSize)
  let code = ''
  while (code.length < CODE_LENGTH) {
    const bytes = crypto.randomBytes(CODE_LENGTH - code.length + 8)
    for (let i = 0; i < bytes.length && code.length < CODE_LENGTH; i += 1) {
      const value = bytes[i]
      if (value < limit) code += CODE_CHARS[value % alphabetSize]
    }
  }
  return code
}

/** 永久绑定：不再写入过期时间 */
function computeBindingExpiresAt() {
  return null
}

function computeAttributionExpiresAt(fromDate = new Date()) {
  const expires = new Date(fromDate)
  expires.setDate(expires.getDate() + REFERRAL_ATTRIBUTION_DAYS)
  return expires
}

function isBindingActive(binding, now = new Date()) {
  if (!binding) return false
  // expires_at 为 null 表示永久；兼容历史有期限的数据
  if (binding.expires_at == null || binding.expires_at === '') return true
  return new Date(binding.expires_at) > new Date(now)
}

function isAttributionActive(attribution, now = new Date()) {
  if (!attribution?.expires_at) return false
  return new Date(attribution.expires_at) > new Date(now)
}

function isDuplicateKeyError(err) {
  return Boolean(err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062))
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

async function getAttributionByUserId(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT user_id, referrer_id, source, attributed_at, expires_at
     FROM referral_attributions
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  )
  return rows[0] || null
}

async function getActiveAttribution(userId, connection = db) {
  const row = await getAttributionByUserId(userId, connection)
  if (!isAttributionActive(row)) return null
  return row
}

/**
 * 从拟绑定的推荐人向上游走，若回到当前被推荐人则形成环（含互绑 A⇄B）。
 * @returns {{ cycle: boolean, path?: number[] }}
 */
async function wouldCreateReferralCycle(refereeId, referrerId, connection = db) {
  const startReferee = Number(refereeId)
  let current = Number(referrerId)
  if (!startReferee || !current) return { cycle: false }

  const path = []
  const seen = new Set()
  // 单层链通常很短；上限防止脏数据死循环
  for (let depth = 0; depth < 32; depth += 1) {
    path.push(current)
    if (current === startReferee) return { cycle: true, path }
    if (seen.has(current)) return { cycle: true, path }
    seen.add(current)

    const upstream = await getBindingByRefereeId(current, connection)
    if (!upstream?.referrer_id) return { cycle: false, path }
    current = Number(upstream.referrer_id)
  }
  return { cycle: true, path }
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

/**
 * 分享进店：写入/覆盖临时成交归因（不创建永久绑定）
 */
async function attributeReferral({ refereeId, code, referrerId, source = 'link', connection = db }) {
  await ensureReferralSchema()

  const normalizedSource = normalizeBindSource(source)
  if (!normalizedSource) {
    return { ok: false, status: 400, error: '无效的归因来源' }
  }

  if (!refereeId || refereeId <= 0) {
    return { ok: false, status: 400, error: '无效的被推荐用户' }
  }

  const resolvedReferrerId = await resolveReferrerId({ code, referrerId }, connection)
  if (!resolvedReferrerId) {
    return { ok: false, status: 400, error: '推荐码或推荐人无效' }
  }

  if (resolvedReferrerId === refereeId) {
    logger.info('referral attribution skipped self-referral', { refereeId })
    return { ok: true, status: 200, skipped: true, reason: 'self_referral' }
  }

  const [refereeRows] = await connection.query('SELECT id FROM wx_users WHERE id = ? LIMIT 1', [refereeId])
  if (!refereeRows.length) {
    return { ok: false, status: 404, error: '用户不存在' }
  }

  const expiresAt = computeAttributionExpiresAt()
  const existing = await getActiveAttribution(refereeId, connection)
  if (
    existing &&
    Number(existing.referrer_id) === Number(resolvedReferrerId) &&
    String(existing.source || '') === normalizedSource
  ) {
    return {
      ok: true,
      status: 200,
      attribution: formatAttribution(existing),
      unchanged: true,
    }
  }

  await connection.query(
    `INSERT INTO referral_attributions (user_id, referrer_id, source, attributed_at, expires_at)
     VALUES (?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       referrer_id = VALUES(referrer_id),
       source = VALUES(source),
       attributed_at = NOW(),
       expires_at = VALUES(expires_at)`,
    [refereeId, resolvedReferrerId, normalizedSource, expiresAt]
  )

  const attribution = await getAttributionByUserId(refereeId, connection)

  logger.info('referral attribution upserted', {
    refereeId,
    referrerId: resolvedReferrerId,
    source: normalizedSource,
    expiresAt,
  })

  return {
    ok: true,
    status: 200,
    attribution: formatAttribution(attribution),
  }
}

/**
 * 用户确认后写入永久绑定（不可改）
 */
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
    logger.info('referral binding skipped self-referral', { refereeId })
    return { ok: true, status: 200, skipped: true, reason: 'self_referral' }
  }

  const cycleCheck = await wouldCreateReferralCycle(refereeId, resolvedReferrerId, connection)
  if (cycleCheck.cycle) {
    const isMutual =
      Array.isArray(cycleCheck.path) &&
      cycleCheck.path.length >= 1 &&
      Number(cycleCheck.path[0]) === Number(resolvedReferrerId) &&
      cycleCheck.path.includes(Number(refereeId))
    logger.info('referral binding rejected circular referral', {
      refereeId,
      referrerId: resolvedReferrerId,
      chain: cycleCheck.path || [],
      mutual: isMutual,
    })
    return {
      ok: false,
      status: 400,
      error: isMutual
        ? '对方已是您的下级（或在您的推荐链上），不能互相绑定为推荐人'
        : '不能互相绑定为推荐人',
      reason: 'circular_referral',
      chain: cycleCheck.path || undefined,
    }
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

  try {
    await connection.query(
      `INSERT INTO referral_bindings (referrer_id, referee_id, source, expires_at)
       VALUES (?, ?, ?, ?)`,
      [resolvedReferrerId, refereeId, normalizedSource, expiresAt]
    )
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err

    const racedBinding = await getBindingByRefereeId(refereeId, connection)
    if (!racedBinding) throw err

    if (Number(racedBinding.referrer_id) === Number(resolvedReferrerId)) {
      logger.info('referral binding already exists (idempotent)', {
        refereeId,
        referrerId: resolvedReferrerId,
        source: normalizedSource,
      })
      return {
        ok: true,
        status: 200,
        binding: formatBinding(racedBinding),
        alreadyBound: true,
      }
    }

    return {
      ok: false,
      status: 409,
      error: '已绑定推荐关系，不可修改',
      binding: formatBinding(racedBinding),
    }
  }

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

function formatAttribution(attribution) {
  if (!attribution) return null
  return {
    referrer_id: attribution.referrer_id,
    user_id: attribution.user_id,
    source: attribution.source,
    attributed_at: attribution.attributed_at,
    expires_at: attribution.expires_at,
    is_active: isAttributionActive(attribution),
    attribution_days: REFERRAL_ATTRIBUTION_DAYS,
  }
}

async function enrichReferrerProfile(referrerId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id, nickname, avatar FROM wx_users WHERE id = ? LIMIT 1`,
    [referrerId]
  )
  const referrer = rows[0]
  return {
    id: Number(referrerId),
    nickname: referrer?.nickname || null,
    avatar: referrer?.avatar || null,
  }
}

async function enrichBindingWithReferrer(binding, connection = db) {
  const formatted = formatBinding(binding)
  if (!formatted) return null
  return {
    ...formatted,
    referrer: await enrichReferrerProfile(binding.referrer_id, connection),
  }
}

async function enrichAttributionWithReferrer(attribution, connection = db) {
  const formatted = formatAttribution(attribution)
  if (!formatted) return null
  return {
    ...formatted,
    referrer: await enrichReferrerProfile(attribution.referrer_id, connection),
  }
}

/**
 * 下单佣金归因：有效临时归因优先，否则用已确认永久绑定
 */
async function resolveOrderReferrerId(refereeId, connection = db) {
  const attribution = await getActiveAttribution(refereeId, connection)
  if (attribution?.referrer_id) {
    if (Number(attribution.referrer_id) === Number(refereeId)) return null
    return attribution.referrer_id
  }

  const binding = await getBindingByRefereeId(refereeId, connection)
  if (!isBindingActive(binding)) return null
  if (Number(binding.referrer_id) === Number(refereeId)) return null
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
    binding_days: null,
    binding_permanent: true,
    attribution_days: REFERRAL_ATTRIBUTION_DAYS,
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
  const activeAttribution = binding ? null : await getActiveAttribution(userId)

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

  const wallet = await getWalletSummary(userId)
  const myBinding = await enrichBindingWithReferrer(binding)
  const pendingAttribution = await enrichAttributionWithReferrer(activeAttribution)

  return adminResult(200, {
    tier: tierProfile,
    referral_code: codeRow?.status === 'active' ? codeRow.code : null,
    my_binding: myBinding,
    pending_attribution: pendingAttribution,
    binding_days: null,
    binding_permanent: true,
    attribution_days: REFERRAL_ATTRIBUTION_DAYS,
    withdraw: {
      ...getWithdrawPolicy(),
      requires_real_name: false,
    },
    first_referral_bonus_yuan: FIRST_REFERRAL_BONUS_YUAN,
    new_user_coupon_yuan: NEW_USER_COUPON_YUAN,
    stats: {
      referred_order_count: Number(orderStats[0]?.referred_order_count || 0),
      share_count: Number(shareStats[0]?.share_count || 0),
      pending_commission_yuan: wallet.pending_commission_yuan,
      available_commission_yuan: wallet.available_commission_yuan,
      withdrawn_commission_yuan: wallet.withdrawn_commission_yuan,
      total_earned_yuan: wallet.total_earned_yuan,
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

async function attributeReferralFromRequest(req) {
  const session = await resolveWxUserId(req)
  if (!session.ok) return session.result

  const { referrerCode, referrerId, source } = req.body || {}
  const result = await attributeReferral({
    refereeId: session.userId,
    code: referrerCode,
    referrerId,
    source,
  })

  if (!result.ok) {
    return adminResult(result.status, {
      error: result.error,
      attribution: result.attribution || undefined,
    })
  }

  if (result.skipped) {
    return adminResult(200, {
      success: false,
      skipped: true,
      reason: result.reason || 'self_referral',
    })
  }

  return adminResult(200, {
    success: true,
    attribution: result.attribution,
  })
}

/**
 * 确认永久绑定：需 confirm=true；无码时用当前有效归因
 */
async function bindReferralFromRequest(req) {
  const session = await resolveWxUserId(req)
  if (!session.ok) return session.result

  const body = req.body || {}
  const confirmed = body.confirm === true || body.confirm === 1 || body.confirm === '1'
  if (!confirmed) {
    return adminResult(400, { error: '请确认后绑定推荐关系' })
  }

  let referrerCode = body.referrerCode
  let referrerId = body.referrerId
  let source = body.source

  const hasReferrerInput = normalizeReferrerCode(referrerCode) || parseReferrerId(referrerId)
  if (!hasReferrerInput) {
    const attribution = await getActiveAttribution(session.userId)
    if (!attribution) {
      return adminResult(400, {
        error: '暂无待确认的推荐人，请先通过分享链接进入',
      })
    }
    referrerId = attribution.referrer_id
    referrerCode = undefined
    source = source || attribution.source
  }

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
      reason: result.reason || undefined,
    })
  }

  if (result.skipped) {
    return adminResult(200, {
      success: false,
      skipped: true,
      reason: result.reason || 'self_referral',
    })
  }

  return adminResult(200, {
    success: true,
    binding: result.binding,
    alreadyBound: result.alreadyBound || undefined,
  })
}

async function tryAttributeReferralOnLogin(userId, body) {
  const { referrerCode, referrerId, source } = body || {}
  const hasReferrerInput = normalizeReferrerCode(referrerCode) || parseReferrerId(referrerId)
  if (!hasReferrerInput) {
    return { attempted: false }
  }

  const result = await attributeReferral({
    refereeId: userId,
    code: referrerCode,
    referrerId,
    source: source || 'link',
  })

  return {
    attempted: true,
    success: result.ok && !result.skipped,
    status: result.status,
    error: result.error || null,
    attribution: result.attribution || null,
    skipped: result.skipped || false,
    reason: result.reason || null,
  }
}

/** @deprecated 登录仅写归因，不再自动绑定；保留别名兼容旧调用 */
async function tryBindReferralOnLogin(userId, body) {
  return tryAttributeReferralOnLogin(userId, body)
}

async function resolveWxUserId(req) {
  if (req.user?.is_wx_user && req.user?.id) {
    return { ok: true, userId: Number(req.user.id) }
  }

  const { resolveAuthFromRequest } = require('../auth')
  const auth = await resolveAuthFromRequest(req)
  if (!auth.ok) {
    return { ok: false, result: adminResult(auth.status, { error: auth.error }) }
  }
  if (!auth.openid) {
    return { ok: false, result: adminResult(403, { error: '仅微信用户可访问' }) }
  }
  return { ok: true, userId: auth.userId }
}

async function getReferralRules() {
  const { VIP_SPEND_THRESHOLD_YUAN } = require('./userTierService')
  const { buildReferralRuleHighlights } = require('../utils/referralCopy')
  const newUserCouponValidDays = parseInt(process.env.NEW_USER_COUPON_VALID_DAYS || '30', 10)
  const withdrawPolicy = getWithdrawPolicy()

  return adminResult(200, {
    binding_days: null,
    binding_permanent: true,
    attribution_days: REFERRAL_ATTRIBUTION_DAYS,
    first_referral_bonus_yuan: FIRST_REFERRAL_BONUS_YUAN,
    new_user_coupon_yuan: NEW_USER_COUPON_YUAN,
    new_user_coupon_valid_days: newUserCouponValidDays,
    vip_spend_threshold_yuan: VIP_SPEND_THRESHOLD_YUAN,
    min_withdraw_yuan: withdrawPolicy.min_yuan,
    max_withdraw_yuan: withdrawPolicy.max_yuan,
    user_daily_withdraw_limit_yuan: withdrawPolicy.user_daily_limit_yuan,
    highlights: buildReferralRuleHighlights({
      firstReferralBonusYuan: FIRST_REFERRAL_BONUS_YUAN,
      newUserCouponYuan: NEW_USER_COUPON_YUAN,
      newUserCouponValidDays,
      vipSpendThresholdYuan: VIP_SPEND_THRESHOLD_YUAN,
      withdrawPolicy,
      attributionDays: REFERRAL_ATTRIBUTION_DAYS,
    }),
  })
}

async function getTierForRequest(req) {
  const session = await resolveWxUserId(req)
  if (!session.ok) return session.result

  const profile = await getUserTierProfile(session.userId)
  if (!profile) {
    return adminResult(404, { error: '用户不存在' })
  }

  const binding = await getBindingByRefereeId(session.userId)
  const myBinding = await enrichBindingWithReferrer(binding)

  return adminResult(200, {
    tier: profile,
    my_binding: myBinding,
    my_referrer: myBinding?.referrer || null,
  })
}

module.exports = {
  adminResult,
  REFERRAL_BINDING_DAYS,
  REFERRAL_ATTRIBUTION_DAYS,
  normalizeReferrerCode,
  parseReferrerId,
  normalizeBindSource,
  computeBindingExpiresAt,
  computeAttributionExpiresAt,
  isBindingActive,
  isAttributionActive,
  ensureReferralCode,
  isDuplicateKeyError,
  attributeReferral,
  bindReferral,
  resolveOrderReferrerId,
  getReferralCodeInfo,
  getReferralCenter,
  getReferralRules,
  recordShareEvent,
  attributeReferralFromRequest,
  bindReferralFromRequest,
  tryAttributeReferralOnLogin,
  tryBindReferralOnLogin,
  getTierForRequest,
  resolveWxUserId,
  getBindingByRefereeId,
  getActiveAttribution,
  formatBinding,
  formatAttribution,
}
