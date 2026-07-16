const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { adjustWalletBalances, roundMoney, parseMoney } = require('./commissionService')
const {
  isFavorConfigured,
  createCouponStock,
  startStock,
  sendCoupon,
  listUserCoupons: listFavorUserCoupons,
  mapFavorCouponToClient,
  buildOutRequestNo,
  getStockCreatorMchid,
} = require('./wechatFavorService')

const FIRST_REFERRAL_BONUS_YUAN = parseFloat(process.env.FIRST_REFERRAL_BONUS_YUAN || '30')
const NEW_USER_COUPON_YUAN = parseFloat(process.env.NEW_USER_COUPON_YUAN || '50')
const NEW_USER_COUPON_SOURCE = 'new_user_welcome'
const BONUS_TYPE_FIRST_REFERRAL = 'first_referral_order'

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

async function getUserOpenid(userId, connection = db) {
  const [rows] = await connection.query(
    'SELECT openid FROM wx_users WHERE id = ? LIMIT 1',
    [userId]
  )
  return rows[0]?.openid ? String(rows[0].openid) : null
}

async function hasWelcomeFavorGrant(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id FROM wx_favor_coupon_grants
     WHERE user_id = ? AND source = ? AND status = 'sent'
     LIMIT 1`,
    [userId, NEW_USER_COUPON_SOURCE]
  )
  return rows.length > 0
}

async function getWelcomeTemplate(connection = db) {
  const [rows] = await connection.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, stock_id,
            stock_creator_mchid, wx_status, is_welcome, is_active
     FROM referral_coupon_templates
     WHERE is_welcome = 1 AND is_active = 1 AND wx_status = 'running'
       AND stock_id IS NOT NULL AND stock_id <> ''
     ORDER BY id DESC
     LIMIT 1`
  )
  return rows[0] || null
}

async function recordFavorGrant({
  userId,
  templateId,
  stockId,
  couponId,
  outRequestNo,
  source,
  status = 'sent',
  errorMessage = null,
}, connection = db) {
  await connection.query(
    `INSERT INTO wx_favor_coupon_grants
     (user_id, template_id, stock_id, coupon_id, out_request_no, source, status, error_message)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       coupon_id = COALESCE(VALUES(coupon_id), coupon_id),
       status = VALUES(status),
       error_message = VALUES(error_message),
       updated_at = NOW()`,
    [
      userId,
      templateId || null,
      String(stockId),
      couponId || null,
      String(outRequestNo),
      source,
      status,
      errorMessage,
    ]
  )
}

async function sendFavorCouponToUser({
  userId,
  template,
  source = 'admin',
  connection = db,
}) {
  if (!template?.stock_id) {
    return { ok: false, error: '模板未绑定微信批次' }
  }
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }

  const openid = await getUserOpenid(userId, connection)
  if (!openid) {
    return { ok: false, error: '用户未绑定微信 openid' }
  }

  const outRequestNo = buildOutRequestNo({
    prefix: source === NEW_USER_COUPON_SOURCE ? 'W' : 'A',
    userId,
    stockId: template.stock_id,
  })

  const sent = await sendCoupon({
    openid,
    stockId: template.stock_id,
    stockCreatorMchid: template.stock_creator_mchid || getStockCreatorMchid(),
    outRequestNo,
  })

  if (!sent.ok) {
    await recordFavorGrant({
      userId,
      templateId: template.id,
      stockId: template.stock_id,
      couponId: null,
      outRequestNo: sent.outRequestNo || outRequestNo,
      source,
      status: 'failed',
      errorMessage: String(sent.error || '发券失败').slice(0, 255),
    }, connection)
    return { ok: false, error: sent.error || '发券失败', code: sent.code }
  }

  await recordFavorGrant({
    userId,
    templateId: template.id,
    stockId: template.stock_id,
    couponId: sent.couponId,
    outRequestNo: sent.outRequestNo || outRequestNo,
    source,
    status: 'sent',
  }, connection)

  return {
    ok: true,
    stock_id: String(template.stock_id),
    coupon_id: sent.couponId,
    out_request_no: sent.outRequestNo || outRequestNo,
  }
}

async function tryGrantNewUserWelcomeCoupon(userId, connection = db) {
  await ensureReferralRewardsSchema()

  if (NEW_USER_COUPON_YUAN <= 0) {
    return { granted: false, reason: 'disabled' }
  }

  if (!isFavorConfigured()) {
    return { granted: false, reason: 'favor_disabled' }
  }

  if (await hasWelcomeFavorGrant(userId, connection)) {
    return { granted: false, alreadyGranted: true }
  }

  const template = await getWelcomeTemplate(connection)
  if (!template) {
    logger.warn('welcome favor template missing', { userId })
    return { granted: false, reason: 'no_welcome_template' }
  }

  try {
    const result = await sendFavorCouponToUser({
      userId,
      template,
      source: NEW_USER_COUPON_SOURCE,
      connection,
    })

    if (!result.ok) {
      logger.warn('new user welcome favor grant failed', { userId, error: result.error })
      return { granted: false, reason: 'send_failed', error: result.error }
    }

    logger.info('new user welcome favor coupon granted', {
      userId,
      stockId: result.stock_id,
      couponId: result.coupon_id,
    })
    return {
      granted: true,
      stock_id: result.stock_id,
      coupon_id: result.coupon_id,
      discount_yuan: parseMoney(template.discount_yuan),
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

async function hasGrantedBonus(userId, bonusType, connection = db) {
  const [rows] = await connection.query(
    'SELECT id FROM referral_bonus_grants WHERE user_id = ? AND bonus_type = ? LIMIT 1',
    [userId, bonusType]
  )
  return rows.length > 0
}

/**
 * Proxy WeChat Favor user coupons for mini program read-only list.
 */
async function listUserCoupons(userId, { status } = {}) {
  await ensureReferralRewardsSchema()

  if (!isFavorConfigured()) {
    return []
  }

  const openid = await getUserOpenid(userId)
  if (!openid) return []

  const favorStatus = status === 'available' || status === 'SENDED'
    ? 'SENDED'
    : (status || undefined)

  const result = await listFavorUserCoupons({
    openid,
    status: favorStatus,
    limit: 50,
  })

  if (!result.ok) {
    logger.warn('listUserCoupons favor failed', { userId, error: result.error })
    return []
  }

  return (result.data || [])
    .map(mapFavorCouponToClient)
    .filter(Boolean)
}

/** Local referral coupons no longer apply at checkout. */
function evaluateReferralCouponApplicability() {
  return { ok: false, error: '优惠券已改为微信支付代金券，结账时自动核销' }
}

async function resolveReferralCouponDiscount() {
  return { discountYuan: 0, coupon: null }
}

async function reserveReferralCouponForOrder() {
  return { ok: true }
}

async function syncReferralCouponForOrder() {
  return { ok: true }
}

async function markReferralCouponUsed() {
  return { ok: true }
}

async function releaseReferralCouponByOrderId() {
  return
}

async function listAdminCouponTemplates() {
  await ensureReferralRewardsSchema()
  const [rows] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, is_active,
            stock_id, stock_creator_mchid, wx_status, is_welcome, max_coupons, updated_at
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
  const maxCoupons = Math.max(1, parseInt(body?.max_coupons, 10) || 10000)
  const isWelcome = Boolean(body?.is_welcome)

  if (!title) return adminResult(400, { error: '请填写优惠券名称' })
  if (discountYuan <= 0) return adminResult(400, { error: '优惠金额无效' })
  if (validDays <= 0 || validDays > 90) return adminResult(400, { error: '有效期需在 1～90 天' })
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }

  const created = await createCouponStock({
    title,
    discountYuan,
    minOrderYuan,
    validDays,
    maxCoupons,
    maxCouponsPerUser: 1,
    comment: title,
  })
  if (!created.ok) {
    return adminResult(400, { error: created.error || '创建微信批次失败', detail: created.raw })
  }

  const started = await startStock(created.stockId, created.stockCreatorMchid)
  const wxStatus = started.ok ? 'running' : 'created'
  if (!started.ok) {
    logger.warn('createAdminCouponTemplate startStock failed', {
      stockId: created.stockId,
      error: started.error,
    })
  }

  if (isWelcome) {
    await db.query(
      'UPDATE referral_coupon_templates SET is_welcome = 0 WHERE is_welcome = 1'
    )
  }

  const [result] = await db.query(
    `INSERT INTO referral_coupon_templates
     (title, discount_yuan, min_order_yuan, valid_days, is_active,
      stock_id, stock_creator_mchid, wx_status, is_welcome, max_coupons)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    [
      title,
      discountYuan,
      Math.max(0, minOrderYuan),
      validDays,
      created.stockId,
      created.stockCreatorMchid,
      wxStatus,
      isWelcome ? 1 : 0,
      maxCoupons,
    ]
  )

  return adminResult(200, {
    success: true,
    id: result.insertId,
    stock_id: created.stockId,
    wx_status: wxStatus,
    start_error: started.ok ? null : started.error,
  })
}

async function grantCouponToUser({ userId, templateId, source = 'admin' }) {
  await ensureReferralRewardsSchema()

  const uid = parseInt(userId, 10)
  if (Number.isNaN(uid) || uid <= 0) {
    return adminResult(400, { error: '无效的用户ID' })
  }

  const tid = parseInt(templateId, 10)
  if (Number.isNaN(tid) || tid <= 0) {
    return adminResult(400, { error: '请选择优惠券模板' })
  }

  const [templates] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, stock_id,
            stock_creator_mchid, wx_status, is_active
     FROM referral_coupon_templates
     WHERE id = ? AND is_active = 1 LIMIT 1`,
    [tid]
  )
  if (!templates.length) return adminResult(404, { error: '优惠券模板不存在' })

  const tpl = templates[0]
  if (!tpl.stock_id || tpl.wx_status !== 'running') {
    return adminResult(400, { error: '模板批次未激活，无法发放' })
  }

  const result = await sendFavorCouponToUser({
    userId: uid,
    template: tpl,
    source,
  })

  if (!result.ok) {
    return adminResult(400, { error: result.error || '发放失败', code: result.code })
  }

  return adminResult(200, {
    success: true,
    coupon_id: result.coupon_id,
    stock_id: result.stock_id,
    out_request_no: result.out_request_no,
  })
}

async function listAdminUserCoupons({ userId, page = 1, pageSize = 20 } = {}) {
  await ensureReferralRewardsSchema()
  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit
  const params = []
  let where = ''

  if (userId) {
    where = 'WHERE g.user_id = ?'
    params.push(userId)
  }

  const [rows] = await db.query(
    `SELECT g.*, wu.nickname, t.title AS template_title, t.discount_yuan
     FROM wx_favor_coupon_grants g
     LEFT JOIN wx_users wu ON wu.id = g.user_id
     LEFT JOIN referral_coupon_templates t ON t.id = g.template_id
     ${where}
     ORDER BY g.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM wx_favor_coupon_grants g ${where}`,
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
  evaluateReferralCouponApplicability,
  resolveReferralCouponDiscount,
  reserveReferralCouponForOrder,
  syncReferralCouponForOrder,
  markReferralCouponUsed,
  releaseReferralCouponByOrderId,
  cancelBonusGrantsByOrderId,
  listAdminCouponTemplates,
  createAdminCouponTemplate,
  grantCouponToUser,
  listAdminUserCoupons,
}
