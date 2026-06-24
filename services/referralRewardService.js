const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const {
  ensureWallet,
  adjustWalletBalances,
  roundMoney,
  parseMoney,
} = require('./commissionService')

const FIRST_REFERRAL_BONUS_YUAN = parseFloat(process.env.FIRST_REFERRAL_BONUS_YUAN || '30')
const NEW_USER_COUPON_YUAN = parseFloat(process.env.NEW_USER_COUPON_YUAN || '50')
const NEW_USER_COUPON_MIN_ORDER_YUAN = parseFloat(process.env.NEW_USER_COUPON_MIN_ORDER_YUAN || '0')
const NEW_USER_COUPON_VALID_DAYS = parseInt(process.env.NEW_USER_COUPON_VALID_DAYS || '30', 10)
const NEW_USER_COUPON_SOURCE = 'new_user_welcome'
const BONUS_TYPE_FIRST_REFERRAL = 'first_referral_order'

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function addDays(fromDate, days) {
  const d = new Date(fromDate)
  d.setDate(d.getDate() + days)
  return d
}

async function hasGrantedBonus(userId, bonusType, connection = db) {
  const [rows] = await connection.query(
    'SELECT id FROM referral_bonus_grants WHERE user_id = ? AND bonus_type = ? LIMIT 1',
    [userId, bonusType]
  )
  return rows.length > 0
}

async function hasWelcomeCoupon(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id FROM user_referral_coupons
     WHERE user_id = ? AND source = ?
     LIMIT 1`,
    [userId, NEW_USER_COUPON_SOURCE]
  )
  return rows.length > 0
}

async function tryGrantNewUserWelcomeCoupon(userId, connection = db) {
  await ensureReferralRewardsSchema()

  if (NEW_USER_COUPON_YUAN <= 0) {
    return { granted: false, reason: 'disabled' }
  }

  if (await hasWelcomeCoupon(userId, connection)) {
    return { granted: false, alreadyGranted: true }
  }

  const discount = roundMoney(NEW_USER_COUPON_YUAN)
  if (discount <= 0) return { granted: false, reason: 'invalid_amount' }

  const expiresAt = addDays(new Date(), NEW_USER_COUPON_VALID_DAYS)
  try {
    const [result] = await connection.query(
      `INSERT INTO user_referral_coupons
       (user_id, template_id, title, discount_yuan, min_order_yuan, status, source, expires_at)
       VALUES (?, NULL, ?, ?, ?, 'available', ?, ?)`,
      [
        userId,
        '新人礼包',
        discount,
        Math.max(0, NEW_USER_COUPON_MIN_ORDER_YUAN),
        NEW_USER_COUPON_SOURCE,
        expiresAt,
      ]
    )

    if (!result || result.affectedRows !== 1) {
      return { granted: false }
    }

    logger.info('new user welcome coupon granted', { userId, discount })
    return {
      granted: true,
      coupon_id: result.insertId,
      discount_yuan: discount,
      expires_at: expiresAt,
    }
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      return { granted: false, alreadyGranted: true }
    }
    throw err
  }
}

async function tryGrantFirstReferralOrderBonus({ referrerId, orderId, connection = db }) {
  await ensureReferralRewardsSchema()
  await ensureCommissionSchema()

  if (!referrerId || !orderId || FIRST_REFERRAL_BONUS_YUAN <= 0) {
    return { granted: false }
  }

  if (await hasGrantedBonus(referrerId, BONUS_TYPE_FIRST_REFERRAL, connection)) {
    return { granted: false, alreadyGranted: true }
  }

  const amount = roundMoney(FIRST_REFERRAL_BONUS_YUAN)
  if (amount <= 0) return { granted: false }

  try {
    const [insertResult] = await connection.query(
      `INSERT INTO referral_bonus_grants
       (user_id, bonus_type, order_id, amount, status)
       VALUES (?, ?, ?, ?, 'settlable')`,
      [referrerId, BONUS_TYPE_FIRST_REFERRAL, orderId, amount]
    )

    if (!insertResult || insertResult.affectedRows !== 1) {
      return { granted: false }
    }

    await adjustWalletBalances(referrerId, {
      availableDelta: amount,
      earnedDelta: amount,
    }, connection)

    logger.info('first referral order bonus granted', { referrerId, orderId, amount })
    return { granted: true, amount }
  } catch (err) {
    if (err && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)) {
      return { granted: false, alreadyGranted: true }
    }
    throw err
  }
}

async function listUserCoupons(userId, { status = 'available' } = {}) {
  await ensureReferralRewardsSchema()
  await expireCouponsIfNeeded(userId)

  const params = [userId]
  let where = 'WHERE user_id = ?'
  if (status) {
    where += ' AND status = ?'
    params.push(status)
  }

  const [rows] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, status, expires_at, created_at
     FROM user_referral_coupons
     ${where}
     ORDER BY expires_at ASC, id DESC`,
    params
  )

  return rows || []
}

async function expireCouponsIfNeeded(userId) {
  await db.query(
    `UPDATE user_referral_coupons
     SET status = 'expired', updated_at = NOW()
     WHERE user_id = ?
       AND status = 'available'
       AND expires_at < NOW()`,
    [userId]
  )
}

async function resolveReferralCouponDiscount(connection, userId, couponId, orderSubtotalYuan) {
  if (!couponId) return { discountYuan: 0, coupon: null }

  await ensureReferralRewardsSchema()
  await expireCouponsIfNeeded(userId)

  const id = parseInt(couponId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return { error: '优惠券无效' }
  }

  const [rows] = await connection.query(
    `SELECT id, title, discount_yuan, min_order_yuan, status, expires_at
     FROM user_referral_coupons
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId]
  )

  const coupon = rows[0]
  if (!coupon || coupon.status !== 'available') {
    return { error: '优惠券不可用' }
  }
  if (new Date(coupon.expires_at) <= new Date()) {
    return { error: '优惠券已过期' }
  }

  const subtotal = parseMoney(orderSubtotalYuan)
  const minOrder = parseMoney(coupon.min_order_yuan)
  if (subtotal < minOrder) {
    return { error: `订单满 ${minOrder} 元可用` }
  }

  const discountYuan = roundMoney(Math.min(parseMoney(coupon.discount_yuan), subtotal))
  if (discountYuan <= 0) {
    return { error: '优惠券金额无效' }
  }

  return { discountYuan, coupon }
}

async function markReferralCouponUsed({ userId, couponId, orderId }, connection = db) {
  if (!couponId || !orderId) return

  await connection.query(
    `UPDATE user_referral_coupons
     SET status = 'used', used_order_id = ?, used_at = NOW(), updated_at = NOW()
     WHERE id = ? AND user_id = ? AND status = 'available'`,
    [orderId, couponId, userId]
  )
}

async function releaseReferralCouponByOrderId(orderId, connection = db) {
  if (!orderId) return
  await connection.query(
    `UPDATE user_referral_coupons
     SET status = 'available', used_order_id = NULL, used_at = NULL, updated_at = NOW()
     WHERE used_order_id = ? AND status = 'used'`,
    [orderId]
  )
}

async function listAdminCouponTemplates() {
  await ensureReferralRewardsSchema()
  const [rows] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, is_active, updated_at
     FROM referral_coupon_templates
     ORDER BY id DESC`
  )
  return rows || []
}

async function createAdminCouponTemplate(body) {
  await ensureReferralRewardsSchema()
  const title = String(body?.title || '').trim()
  const discountYuan = parseMoney(body?.discount_yuan)
  const minOrderYuan = parseMoney(body?.min_order_yuan)
  const validDays = parseInt(body?.valid_days, 10) || 30

  if (!title) return adminResult(400, { error: '请填写优惠券名称' })
  if (discountYuan <= 0) return adminResult(400, { error: '优惠金额无效' })
  if (validDays <= 0 || validDays > 365) return adminResult(400, { error: '有效期无效' })

  const [result] = await db.query(
    `INSERT INTO referral_coupon_templates
     (title, discount_yuan, min_order_yuan, valid_days, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [title, discountYuan, Math.max(0, minOrderYuan), validDays]
  )

  return adminResult(200, { success: true, id: result.insertId })
}

async function grantCouponToUser({ userId, templateId, title, discountYuan, minOrderYuan, validDays, source = 'admin' }) {
  await ensureReferralRewardsSchema()

  let couponTitle = title
  let discount = parseMoney(discountYuan)
  let minOrder = parseMoney(minOrderYuan)
  let days = parseInt(validDays, 10) || 30

  if (templateId) {
    const [templates] = await db.query(
      `SELECT id, title, discount_yuan, min_order_yuan, valid_days
       FROM referral_coupon_templates
       WHERE id = ? AND is_active = 1 LIMIT 1`,
      [templateId]
    )
    if (!templates.length) return adminResult(404, { error: '优惠券模板不存在' })
    const tpl = templates[0]
    couponTitle = tpl.title
    discount = parseMoney(tpl.discount_yuan)
    minOrder = parseMoney(tpl.min_order_yuan)
    days = parseInt(tpl.valid_days, 10) || 30
  }

  if (!couponTitle || discount <= 0) {
    return adminResult(400, { error: '优惠券参数无效' })
  }

  const expiresAt = addDays(new Date(), days)
  const [result] = await db.query(
    `INSERT INTO user_referral_coupons
     (user_id, template_id, title, discount_yuan, min_order_yuan, status, source, expires_at)
     VALUES (?, ?, ?, ?, ?, 'available', ?, ?)`,
    [
      userId,
      templateId || null,
      couponTitle,
      discount,
      Math.max(0, minOrder),
      source,
      expiresAt,
    ]
  )

  return adminResult(200, { success: true, coupon_id: result.insertId })
}

async function listAdminUserCoupons({ userId, page = 1, pageSize = 20 } = {}) {
  await ensureReferralRewardsSchema()
  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit
  const params = []
  let where = ''

  if (userId) {
    where = 'WHERE urc.user_id = ?'
    params.push(userId)
  }

  const [rows] = await db.query(
    `SELECT urc.*, wu.nickname
     FROM user_referral_coupons urc
     LEFT JOIN wx_users wu ON wu.id = urc.user_id
     ${where}
     ORDER BY urc.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM user_referral_coupons urc ${where}`,
    params
  )

  return {
    items: rows || [],
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
  }
}

async function cancelBonusGrantsByOrderId(orderId, connection = db) {
  if (!orderId) return { cancelled: 0 }

  const [rows] = await connection.query(
    `SELECT id, user_id, amount, status
     FROM referral_bonus_grants
     WHERE order_id = ? AND status IN ('settlable', 'withdrawn')`,
    [orderId]
  )

  let cancelled = 0
  for (const row of rows || []) {
    const amount = parseMoney(row.amount)
    if (row.status === 'settlable') {
      await adjustWalletBalances(row.user_id, {
        availableDelta: -amount,
        earnedDelta: -amount,
      }, connection)
    }
    await connection.query(
      `UPDATE referral_bonus_grants SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    cancelled += 1
  }

  return { cancelled }
}

module.exports = {
  adminResult,
  FIRST_REFERRAL_BONUS_YUAN,
  NEW_USER_COUPON_YUAN,
  BONUS_TYPE_FIRST_REFERRAL,
  tryGrantNewUserWelcomeCoupon,
  tryGrantFirstReferralOrderBonus,
  listUserCoupons,
  resolveReferralCouponDiscount,
  markReferralCouponUsed,
  releaseReferralCouponByOrderId,
  cancelBonusGrantsByOrderId,
  listAdminCouponTemplates,
  createAdminCouponTemplate,
  grantCouponToUser,
  listAdminUserCoupons,
}
