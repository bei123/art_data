const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { adjustWalletBalances, roundMoney, parseMoney } = require('./commissionService')
const { generateWxCouponCode } = require('./wxCardService')
const { isWxCardSyncEnabled } = require('./wechatOaTokenService')

const FIRST_REFERRAL_BONUS_YUAN = parseFloat(process.env.FIRST_REFERRAL_BONUS_YUAN || '30')
const NEW_USER_COUPON_YUAN = parseFloat(process.env.NEW_USER_COUPON_YUAN || '50')
const NEW_USER_COUPON_MIN_ORDER_YUAN = parseFloat(process.env.NEW_USER_COUPON_MIN_ORDER_YUAN || '0')
const NEW_USER_COUPON_VALID_DAYS = parseInt(process.env.NEW_USER_COUPON_VALID_DAYS || '30', 10)
const NEW_USER_COUPON_TEMPLATE_ID = parseInt(process.env.NEW_USER_COUPON_TEMPLATE_ID || '0', 10)
const NEW_USER_COUPON_SOURCE = 'new_user_welcome'
const BONUS_TYPE_FIRST_REFERRAL = 'first_referral_order'
const LIST_CACHE_SECONDS = Math.max(
  0,
  parseInt(process.env.WX_CARD_LIST_CACHE_SECONDS || '45', 10) || 45
)

function mapCouponListItem(row, { inWalletSet = null, walletSync = 'local' } = {}) {
  const inWallet = inWalletSet
    ? inWalletSet.has(String(row.wx_code || ''))
    : ['in_wallet', 'consumed'].includes(String(row.wx_wallet_status || ''))
  const canCheckout = ['available', 'reserved'].includes(String(row.status || ''))
  const needAddCard = Boolean(
    row.wx_card_id &&
      row.wx_code &&
      canCheckout &&
      !inWallet &&
      row.wx_wallet_status !== 'consumed'
  )

  return {
    id: row.id,
    title: row.title,
    discount_yuan: row.discount_yuan,
    min_order_yuan: row.min_order_yuan,
    status: row.status,
    expires_at: row.expires_at,
    created_at: row.created_at,
    wx_card_id: row.wx_card_id || null,
    wx_code: row.wx_code || null,
    wx_wallet_status: row.wx_wallet_status || 'not_added',
    in_wallet: inWallet,
    can_checkout: canCheckout,
    need_add_card: needAddCard,
    wallet_sync: walletSync,
  }
}

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

  let templateId = null
  let title = '新人礼包'
  let discount = roundMoney(NEW_USER_COUPON_YUAN)
  let minOrder = Math.max(0, NEW_USER_COUPON_MIN_ORDER_YUAN)
  let validDays = NEW_USER_COUPON_VALID_DAYS
  let wxCardId = null

  if (NEW_USER_COUPON_TEMPLATE_ID > 0) {
    const [templates] = await connection.query(
      `SELECT id, title, discount_yuan, min_order_yuan, valid_days, wx_card_id, wx_sync_enabled
       FROM referral_coupon_templates
       WHERE id = ? AND is_active = 1
       LIMIT 1`,
      [NEW_USER_COUPON_TEMPLATE_ID]
    )
    if (templates[0]) {
      const tpl = templates[0]
      templateId = tpl.id
      title = tpl.title
      discount = roundMoney(tpl.discount_yuan)
      minOrder = Math.max(0, parseMoney(tpl.min_order_yuan))
      validDays = parseInt(tpl.valid_days, 10) || validDays
      if (tpl.wx_sync_enabled && tpl.wx_card_id) wxCardId = tpl.wx_card_id
    }
  }

  if (discount <= 0) return { granted: false, reason: 'invalid_amount' }

  const expiresAt = addDays(new Date(), validDays)
  const wxCode = generateWxCouponCode()
  try {
    const [result] = await connection.query(
      `INSERT INTO user_referral_coupons
       (user_id, template_id, wx_card_id, wx_code, title, discount_yuan, min_order_yuan,
        status, source, expires_at, wx_wallet_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, 'not_added')`,
      [
        userId,
        templateId,
        wxCardId,
        wxCode,
        title,
        discount,
        minOrder,
        NEW_USER_COUPON_SOURCE,
        expiresAt,
      ]
    )

    if (!result || result.affectedRows !== 1) {
      return { granted: false }
    }

    logger.info('new user welcome coupon granted', { userId, discount, wxCode, wxCardId })
    return {
      granted: true,
      coupon_id: result.insertId,
      discount_yuan: discount,
      expires_at: expiresAt,
      wx_card_id: wxCardId,
      need_add_card: Boolean(wxCardId),
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

async function loadLocalUserCoupons(userId, status) {
  const params = [userId]
  let where = 'WHERE user_id = ?'
  if (status) {
    where += ' AND status = ?'
    params.push(status)
  }

  const [rows] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, status, expires_at, created_at,
            template_id, wx_card_id, wx_code, wx_wallet_status
     FROM user_referral_coupons
     ${where}
     ORDER BY expires_at ASC, id DESC`,
    params
  )
  return rows || []
}

async function importWalletCouponForUser(userId, { cardId, code }) {
  const [existing] = await db.query(
    `SELECT id, user_id FROM user_referral_coupons WHERE wx_code = ? LIMIT 1`,
    [code]
  )
  if (existing[0]) {
    if (Number(existing[0].user_id) !== Number(userId)) {
      logger.warn('wx_code belongs to another user', {
        code,
        userId,
        owner: existing[0].user_id,
      })
      return null
    }
    await db.query(
      `UPDATE user_referral_coupons
       SET wx_card_id = COALESCE(wx_card_id, ?),
           wx_wallet_status = 'in_wallet',
           wx_added_at = COALESCE(wx_added_at, NOW()),
           updated_at = NOW()
       WHERE id = ?`,
      [cardId, existing[0].id]
    )
    return existing[0].id
  }

  const [templates] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days
     FROM referral_coupon_templates
     WHERE wx_card_id = ? AND is_active = 1
     LIMIT 1`,
    [cardId]
  )
  const tpl = templates[0]
  if (!tpl) {
    logger.warn('wallet coupon has no local template', { userId, cardId, code })
    return null
  }

  const expiresAt = addDays(new Date(), parseInt(tpl.valid_days, 10) || 30)
  const [result] = await db.query(
    `INSERT INTO user_referral_coupons
     (user_id, template_id, wx_card_id, wx_code, title, discount_yuan, min_order_yuan,
      status, source, expires_at, wx_wallet_status, wx_added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'available', 'wx_wallet_import', ?, 'in_wallet', NOW())`,
    [
      userId,
      tpl.id,
      cardId,
      code,
      tpl.title,
      tpl.discount_yuan,
      tpl.min_order_yuan,
      expiresAt,
    ]
  )
  return result.insertId
}

async function syncUserCouponsFromWallet(userId) {
  const [users] = await db.query(
    'SELECT id, oa_openid FROM wx_users WHERE id = ? LIMIT 1',
    [userId]
  )
  const oaOpenid = users[0]?.oa_openid
  if (!oaOpenid) {
    return { walletSync: 'unavailable', inWalletCodes: new Set() }
  }

  try {
    const { getUserCardList } = require('./wxCardService')
    const [templates] = await db.query(
      `SELECT wx_card_id FROM referral_coupon_templates
       WHERE wx_card_id IS NOT NULL AND wx_sync_enabled = 1`
    )
    const cardIds = (templates || []).map((t) => t.wx_card_id).filter(Boolean)

    const lists = []
    if (cardIds.length === 0) {
      lists.push(await getUserCardList(oaOpenid))
    } else {
      for (const cardId of cardIds) {
        lists.push(await getUserCardList(oaOpenid, cardId))
      }
    }

    const flat = lists.flat()
    const inWalletCodes = new Set()
    for (const item of flat) {
      const code = String(item.code || '').trim()
      const cardId = String(item.card_id || '').trim()
      if (!code || !cardId) continue
      inWalletCodes.add(code)
      await importWalletCouponForUser(userId, { cardId, code })
    }

    // 本地标记卡包已有
    if (inWalletCodes.size > 0) {
      const codes = [...inWalletCodes]
      await db.query(
        `UPDATE user_referral_coupons
         SET wx_wallet_status = 'in_wallet',
             wx_added_at = COALESCE(wx_added_at, NOW()),
             updated_at = NOW()
         WHERE user_id = ?
           AND wx_code IN (${codes.map(() => '?').join(',')})
           AND wx_wallet_status NOT IN ('consumed')`,
        [userId, ...codes]
      )
    }

    return { walletSync: 'ok', inWalletCodes }
  } catch (err) {
    logger.warn('syncUserCouponsFromWallet failed', { userId, err: err.message })
    return { walletSync: 'stale', inWalletCodes: new Set(), error: err.message }
  }
}

async function listUserCoupons(userId, { status = 'available', sync = false, force = false } = {}) {
  await ensureReferralRewardsSchema()
  await expireCouponsIfNeeded(userId)

  const wantSync = Boolean(sync) && isWxCardSyncEnabled()
  const cacheKey = `wx:coupon_list:${userId}:${status || 'all'}`

  if (wantSync && !force && LIST_CACHE_SECONDS > 0) {
    try {
      const cached = await redisClient.get(cacheKey)
      if (cached) return JSON.parse(cached)
    } catch {
      // ignore cache errors
    }
  }

  let walletSync = 'local'
  let inWalletCodes = new Set()

  if (wantSync) {
    const synced = await syncUserCouponsFromWallet(userId)
    walletSync = synced.walletSync
    inWalletCodes = synced.inWalletCodes || new Set()
  }

  const rows = await loadLocalUserCoupons(userId, status)
  const items = rows.map((row) =>
    mapCouponListItem(row, {
      inWalletSet: wantSync ? inWalletCodes : null,
      walletSync,
    })
  )

  if (wantSync && LIST_CACHE_SECONDS > 0) {
    try {
      await redisClient.setEx(cacheKey, LIST_CACHE_SECONDS, JSON.stringify(items))
    } catch {
      // ignore
    }
  }

  return items
}

async function expireCouponsIfNeeded(userId) {
  await db.query(
    `UPDATE user_referral_coupons
     SET status = 'expired', used_order_id = NULL, updated_at = NOW()
     WHERE user_id = ?
       AND status IN ('available', 'reserved')
       AND expires_at < NOW()`,
    [userId]
  )
}

function evaluateReferralCouponApplicability({
  itemsSubtotalYuan,
  orderBaseYuan,
  couponDiscountYuan,
  minOrderYuan,
}) {
  const itemsSubtotal = parseMoney(itemsSubtotalYuan)
  const orderBase = parseMoney(orderBaseYuan)
  const faceValue = parseMoney(couponDiscountYuan)
  const minOrder = parseMoney(minOrderYuan)

  if (faceValue <= 0) {
    return { ok: false, error: '优惠券金额无效' }
  }
  if (itemsSubtotal < faceValue) {
    return { ok: false, error: '商品金额低于优惠券面额，不可使用' }
  }
  if (orderBase < minOrder) {
    return { ok: false, error: `订单满 ${minOrder} 元可用` }
  }

  return { ok: true, discountYuan: roundMoney(faceValue) }
}

async function isReferralCouponInUseByOtherOrder(connection, userId, couponId, excludeOrderId = null) {
  const params = [couponId, userId]
  let excludeSql = ''
  if (excludeOrderId) {
    excludeSql = ' AND o.id <> ?'
    params.push(excludeOrderId)
  }

  const [rows] = await connection.query(
    `SELECT o.id
     FROM orders o
     WHERE o.referral_coupon_id = ?
       AND o.user_id = ?
       AND o.trade_state IN ('NOTPAY', 'SUCCESS', 'PAYERROR')
       ${excludeSql}
     LIMIT 1`,
    params
  )

  return rows.length > 0
}

async function resolveReferralCouponDiscount(
  connection,
  userId,
  couponId,
  orderBaseYuan,
  itemsSubtotalYuan = null,
  orderId = null
) {
  if (!couponId) return { discountYuan: 0, coupon: null }

  await ensureReferralRewardsSchema()
  await expireCouponsIfNeeded(userId)

  const id = parseInt(couponId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return { error: '优惠券无效' }
  }

  const parsedOrderId = orderId ? parseInt(orderId, 10) : null

  const [rows] = await connection.query(
    `SELECT id, title, discount_yuan, min_order_yuan, status, expires_at, used_order_id
     FROM user_referral_coupons
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [id, userId]
  )

  const coupon = rows[0]
  if (!coupon) {
    return { error: '优惠券不可用' }
  }

  const isAvailable = coupon.status === 'available'
  const isReservedForOrder = coupon.status === 'reserved'
    && parsedOrderId
    && Number(coupon.used_order_id) === parsedOrderId

  if (!isAvailable && !isReservedForOrder) {
    if (coupon.status === 'used') return { error: '优惠券已使用' }
    return { error: '优惠券不可用' }
  }
  if (new Date(coupon.expires_at) <= new Date()) {
    return { error: '优惠券已过期' }
  }

  if (!isReservedForOrder) {
    const inUseElsewhere = await isReferralCouponInUseByOtherOrder(
      connection,
      userId,
      id,
      parsedOrderId
    )
    if (inUseElsewhere) {
      return { error: '优惠券已在其他订单中使用' }
    }
  }

  const itemsSubtotal = parseMoney(
    itemsSubtotalYuan != null ? itemsSubtotalYuan : orderBaseYuan
  )
  const applicability = evaluateReferralCouponApplicability({
    itemsSubtotalYuan: itemsSubtotal,
    orderBaseYuan,
    couponDiscountYuan: coupon.discount_yuan,
    minOrderYuan: coupon.min_order_yuan,
  })
  if (!applicability.ok) {
    return { error: applicability.error }
  }

  return { discountYuan: applicability.discountYuan, coupon }
}

async function reserveReferralCouponForOrder({ userId, couponId, orderId }, connection = db) {
  if (!couponId || !orderId) return { ok: true }

  const parsedCouponId = parseInt(couponId, 10)
  const parsedOrderId = parseInt(orderId, 10)
  if (Number.isNaN(parsedCouponId) || parsedCouponId <= 0) {
    return { error: '优惠券无效' }
  }
  if (Number.isNaN(parsedOrderId) || parsedOrderId <= 0) {
    return { error: '订单无效' }
  }

  const [updateResult] = await connection.query(
    `UPDATE user_referral_coupons
     SET status = 'reserved', used_order_id = ?, updated_at = NOW()
     WHERE id = ? AND user_id = ? AND status = 'available'
       AND (used_order_id IS NULL OR used_order_id = ?)`,
    [parsedOrderId, parsedCouponId, userId, parsedOrderId]
  )

  if (updateResult.affectedRows === 1) {
    return { ok: true }
  }

  const [rows] = await connection.query(
    `SELECT status, used_order_id
     FROM user_referral_coupons
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [parsedCouponId, userId]
  )
  const row = rows[0]
  if (row?.status === 'reserved' && Number(row.used_order_id) === parsedOrderId) {
    return { ok: true }
  }
  if (row?.status === 'used') {
    return { error: '优惠券已使用' }
  }
  return { error: '优惠券不可用' }
}

async function syncReferralCouponForOrder({
  userId,
  orderId,
  referralCouponId,
  previousReferralCouponId,
}, connection = db) {
  const nextCouponId = referralCouponId ? parseInt(referralCouponId, 10) : null
  const prevCouponId = previousReferralCouponId ? parseInt(previousReferralCouponId, 10) : null

  if (prevCouponId && (!nextCouponId || prevCouponId !== nextCouponId)) {
    await releaseReferralCouponByOrderId(orderId, connection)
  }

  if (!nextCouponId) {
    return { ok: true }
  }

  const reserved = await reserveReferralCouponForOrder({
    userId,
    couponId: nextCouponId,
    orderId,
  }, connection)
  if (reserved.error) {
    return { error: reserved.error }
  }
  return { ok: true }
}

async function markReferralCouponUsed({ userId, couponId, orderId }, connection = db) {
  if (!couponId || !orderId) return { ok: false }

  const [result] = await connection.query(
    `UPDATE user_referral_coupons
     SET status = 'used', used_order_id = ?, used_at = NOW(), updated_at = NOW()
     WHERE id = ? AND user_id = ?
       AND status IN ('available', 'reserved')
       AND (used_order_id IS NULL OR used_order_id = ?)`,
    [orderId, couponId, userId, orderId]
  )

  if (!result || result.affectedRows !== 1) {
    logger.warn('markReferralCouponUsed skipped or failed', { userId, couponId, orderId })
    return { ok: false }
  }
  return { ok: true }
}

async function releaseReferralCouponByOrderId(orderId, connection = db) {
  if (!orderId) return
  await connection.query(
    `UPDATE user_referral_coupons
     SET status = 'available', used_order_id = NULL, used_at = NULL, updated_at = NOW()
     WHERE used_order_id = ? AND status IN ('reserved', 'used')`,
    [orderId]
  )
}

async function listAdminCouponTemplates() {
  await ensureReferralRewardsSchema()
  const [rows] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, is_active, updated_at,
            wx_card_id, wx_card_status, wx_sync_enabled, wx_logo_url, wx_brand_name, wx_color, wx_quantity
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

  const wxLogoUrl = String(body?.wx_logo_url || '').trim() || null
  const wxBrandName = String(body?.wx_brand_name || '').trim() || null
  const wxColor = String(body?.wx_color || '').trim() || null

  const [result] = await db.query(
    `INSERT INTO referral_coupon_templates
     (title, discount_yuan, min_order_yuan, valid_days, is_active, wx_logo_url, wx_brand_name, wx_color)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
    [title, discountYuan, Math.max(0, minOrderYuan), validDays, wxLogoUrl, wxBrandName, wxColor]
  )

  return adminResult(200, { success: true, id: result.insertId })
}

async function grantCouponToUser({ userId, templateId, title, discountYuan, minOrderYuan, validDays, source = 'admin' }) {
  await ensureReferralRewardsSchema()

  let couponTitle = title
  let discount = parseMoney(discountYuan)
  let minOrder = parseMoney(minOrderYuan)
  let days = parseInt(validDays, 10) || 30

  let wxCardId = null

  if (templateId) {
    const [templates] = await db.query(
      `SELECT id, title, discount_yuan, min_order_yuan, valid_days, wx_card_id, wx_sync_enabled
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
    if (tpl.wx_sync_enabled && tpl.wx_card_id) wxCardId = tpl.wx_card_id
  }

  if (!couponTitle || discount <= 0) {
    return adminResult(400, { error: '优惠券参数无效' })
  }

  const expiresAt = addDays(new Date(), days)
  const wxCode = generateWxCouponCode()
  const [result] = await db.query(
    `INSERT INTO user_referral_coupons
     (user_id, template_id, wx_card_id, wx_code, title, discount_yuan, min_order_yuan,
      status, source, expires_at, wx_wallet_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'available', ?, ?, 'not_added')`,
    [
      userId,
      templateId || null,
      wxCardId,
      wxCode,
      couponTitle,
      discount,
      Math.max(0, minOrder),
      source,
      expiresAt,
    ]
  )

  return adminResult(200, {
    success: true,
    coupon_id: result.insertId,
    wx_card_id: wxCardId,
    wx_code: wxCode,
    need_add_card: Boolean(wxCardId),
  })
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
