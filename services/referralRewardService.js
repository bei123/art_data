const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { adjustWalletBalances, roundMoney, parseMoney } = require('./commissionService')
const {
  isFavorConfigured,
  createCouponStock,
  startStockWithRetry,
  pauseStock,
  restartStock,
  listStocks,
  getStock,
  listStockMerchants,
  isMchidAvailableForStock,
  listStockItems,
  isGoodsIdAvailableForStock,
  mapFavorStockToClient,
  mapWxStockStatusToLocal,
  sendCoupon,
  listUserCoupons: listFavorUserCoupons,
  getCoupon,
  mapFavorCouponToClient,
  getFavorCallback,
  setFavorCallback,
  getDefaultFavorNotifyUrl,
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
  if (template.wx_status && template.wx_status !== 'running') {
    return { ok: false, error: '批次未在运营中，无法发券' }
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
    userId,
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

    const { repayDebtFromAvailable } = require('./commissionService')
    await repayDebtFromAvailable(referrerId, connection)

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
 * query.status:
 *   available | SENDED → 创建方商户号 + SENDED
 *   used | USED → 创建方商户号 + USED（可用+已实扣）
 *   all → 创建方商户号，不限状态
 *   usable → 可用商户号（仅本店可用券，无分页）
 */
async function listUserCoupons(userId, {
  status,
  stockId,
  offset = 0,
  limit = 50,
} = {}) {
  await ensureReferralRewardsSchema()

  if (!isFavorConfigured()) {
    return { items: [], total: 0 }
  }

  const openid = await getUserOpenid(userId)
  if (!openid) return { items: [], total: 0 }

  const rawStatus = status != null ? String(status).trim() : 'available'
  const upper = rawStatus.toUpperCase()

  let favorOpts
  if (upper === 'USABLE' || upper === 'AVAILABLE_MCH') {
    favorOpts = {
      openid,
      queryBy: 'available',
      availableMchid: getStockCreatorMchid(),
    }
  } else {
    let favorStatus
    if (upper === 'ALL' || upper === '') {
      favorStatus = undefined
    } else if (upper === 'AVAILABLE' || upper === 'SENDED') {
      favorStatus = 'SENDED'
    } else if (upper === 'USED') {
      favorStatus = 'USED'
    } else {
      favorStatus = upper
    }
    favorOpts = {
      openid,
      queryBy: 'creator',
      creatorMchid: getStockCreatorMchid(),
      status: favorStatus,
      stockId: stockId || undefined,
      offset,
      limit,
    }
  }

  const result = await listFavorUserCoupons(favorOpts)

  if (!result.ok) {
    logger.warn('listUserCoupons favor failed', { userId, error: result.error })
    return { items: [], total: 0, error: result.error }
  }

  const items = (result.data || [])
    .map(mapFavorCouponToClient)
    .filter(Boolean)

  return {
    items,
    total: result.totalCount,
    offset: result.offset,
    limit: result.limit,
  }
}

/**
 * Query one Favor coupon detail for a user:
 * GET /v3/marketing/favor/users/{openid}/coupons/{coupon_id}
 */
async function getUserCouponDetail(userId, couponId) {
  await ensureReferralRewardsSchema()

  if (!isFavorConfigured()) {
    return { ok: false, status: 400, error: '微信免充值代金券未启用或配置不完整' }
  }

  const cid = String(couponId || '').trim()
  if (!cid) return { ok: false, status: 400, error: '缺少 coupon_id' }

  const openid = await getUserOpenid(userId)
  if (!openid) return { ok: false, status: 400, error: '用户未绑定微信 openid' }

  const result = await getCoupon({ openid, couponId: cid })
  if (!result.ok) {
    return {
      ok: false,
      status: result.httpStatus === 404 ? 404 : 400,
      error: result.error || '查询券详情失败',
      code: result.code,
      detail: result.raw,
    }
  }

  return {
    ok: true,
    status: 200,
    item: mapFavorCouponToClient(result.coupon),
    raw: result.raw,
  }
}

/**
 * Admin: query Favor coupon by user_id + coupon_id.
 */
async function getAdminUserCouponDetail(userId, couponId) {
  const uid = parseInt(userId, 10)
  if (Number.isNaN(uid) || uid <= 0) {
    return adminResult(400, { error: '无效的用户ID' })
  }
  const result = await getUserCouponDetail(uid, couponId)
  if (!result.ok) {
    return adminResult(result.status || 400, {
      error: result.error,
      code: result.code,
      detail: result.detail,
    })
  }
  return adminResult(200, { item: result.item, raw: result.raw })
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
  const maxCoupons = Math.max(5, parseInt(body?.max_coupons, 10) || 10000)
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

  const started = await startStockWithRetry(created.stockId, created.stockCreatorMchid)
  const wxStatus = started.ok ? 'running' : 'created'
  if (!started.ok) {
    logger.warn('createAdminCouponTemplate startStock failed', {
      stockId: created.stockId,
      error: started.error,
      attempts: started.attempt,
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
    start_time: started.startTime || null,
    start_error: started.ok ? null : started.error,
  })
}

async function startAdminCouponTemplate(templateId) {
  await ensureReferralRewardsSchema()
  const id = parseInt(templateId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的模板ID' })
  }

  const [rows] = await db.query(
    `SELECT id, stock_id, stock_creator_mchid, wx_status
     FROM referral_coupon_templates
     WHERE id = ? LIMIT 1`,
    [id]
  )
  const tpl = rows[0]
  if (!tpl) return adminResult(404, { error: '模板不存在' })
  if (!tpl.stock_id) return adminResult(400, { error: '模板未绑定微信批次' })
  if (tpl.wx_status === 'running') {
    return adminResult(200, { success: true, wx_status: 'running', stock_id: tpl.stock_id })
  }

  const started = await startStockWithRetry(
    tpl.stock_id,
    tpl.stock_creator_mchid || getStockCreatorMchid()
  )
  if (!started.ok) {
    return adminResult(400, {
      error: started.error || '激活失败',
      detail: started.raw,
      stock_id: tpl.stock_id,
    })
  }

  await db.query(
    `UPDATE referral_coupon_templates
     SET wx_status = 'running', updated_at = NOW()
     WHERE id = ?`,
    [id]
  )

  return adminResult(200, {
    success: true,
    stock_id: tpl.stock_id,
    wx_status: 'running',
    start_time: started.startTime || null,
  })
}

async function pauseAdminCouponTemplate(templateId) {
  await ensureReferralRewardsSchema()
  const id = parseInt(templateId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的模板ID' })
  }

  const [rows] = await db.query(
    `SELECT id, stock_id, stock_creator_mchid, wx_status
     FROM referral_coupon_templates
     WHERE id = ? LIMIT 1`,
    [id]
  )
  const tpl = rows[0]
  if (!tpl) return adminResult(404, { error: '模板不存在' })
  if (!tpl.stock_id) return adminResult(400, { error: '模板未绑定微信批次' })
  if (tpl.wx_status === 'paused') {
    return adminResult(200, { success: true, wx_status: 'paused', stock_id: tpl.stock_id })
  }
  if (tpl.wx_status !== 'running') {
    return adminResult(400, { error: '仅运营中的批次可暂停' })
  }

  const paused = await pauseStock(
    tpl.stock_id,
    tpl.stock_creator_mchid || getStockCreatorMchid()
  )
  if (!paused.ok) {
    return adminResult(400, {
      error: paused.error || '暂停失败',
      detail: paused.raw,
      stock_id: tpl.stock_id,
    })
  }

  await db.query(
    `UPDATE referral_coupon_templates
     SET wx_status = 'paused', updated_at = NOW()
     WHERE id = ?`,
    [id]
  )

  return adminResult(200, {
    success: true,
    stock_id: tpl.stock_id,
    wx_status: 'paused',
    pause_time: paused.pauseTime || null,
  })
}

async function restartAdminCouponTemplate(templateId) {
  await ensureReferralRewardsSchema()
  const id = parseInt(templateId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的模板ID' })
  }

  const [rows] = await db.query(
    `SELECT id, stock_id, stock_creator_mchid, wx_status
     FROM referral_coupon_templates
     WHERE id = ? LIMIT 1`,
    [id]
  )
  const tpl = rows[0]
  if (!tpl) return adminResult(404, { error: '模板不存在' })
  if (!tpl.stock_id) return adminResult(400, { error: '模板未绑定微信批次' })
  if (tpl.wx_status === 'running') {
    return adminResult(200, { success: true, wx_status: 'running', stock_id: tpl.stock_id })
  }
  if (tpl.wx_status !== 'paused') {
    return adminResult(400, { error: '仅已暂停的批次可重启' })
  }

  const restarted = await restartStock(
    tpl.stock_id,
    tpl.stock_creator_mchid || getStockCreatorMchid()
  )
  if (!restarted.ok) {
    return adminResult(400, {
      error: restarted.error || '重启失败',
      detail: restarted.raw,
      stock_id: tpl.stock_id,
    })
  }

  await db.query(
    `UPDATE referral_coupon_templates
     SET wx_status = 'running', updated_at = NOW()
     WHERE id = ?`,
    [id]
  )

  return adminResult(200, {
    success: true,
    stock_id: tpl.stock_id,
    wx_status: 'running',
    restart_time: restarted.restartTime || null,
  })
}

async function listAdminWxFavorStocks(query = {}) {
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }

  const offset = parseInt(query.offset, 10) || 0
  const limit = Math.min(10, Math.max(1, parseInt(query.limit, 10) || 10))
  const status = query.status ? String(query.status) : undefined

  const result = await listStocks({ offset, limit, status })
  if (!result.ok) {
    return adminResult(400, { error: result.error || '查询微信批次失败', detail: result.raw })
  }

  return adminResult(200, {
    items: (result.data || []).map(mapFavorStockToClient).filter(Boolean),
    total: result.totalCount,
    offset: result.offset,
    limit: result.limit,
  })
}

/**
 * Query one WeChat stock by stock_id: GET /v3/marketing/favor/stocks/{stock_id}
 */
async function getAdminWxFavorStock(stockId) {
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }
  const id = String(stockId || '').trim()
  if (!id) return adminResult(400, { error: '缺少 stock_id' })

  const result = await getStock(id)
  if (!result.ok) {
    return adminResult(result.httpStatus === 404 ? 404 : 400, {
      error: result.error || '查询批次详情失败',
      detail: result.raw,
    })
  }

  return adminResult(200, {
    item: mapFavorStockToClient(result.stock),
    raw: result.raw,
  })
}

/**
 * List available merchants for a stock:
 * GET /v3/marketing/favor/stocks/{stock_id}/merchants
 */
async function listAdminWxFavorStockMerchants(stockId, query = {}) {
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }
  const id = String(stockId || '').trim()
  if (!id) return adminResult(400, { error: '缺少 stock_id' })

  const offset = Math.max(0, parseInt(query.offset, 10) || 0)
  const limit = Math.min(50, Math.max(1, parseInt(query.limit, 10) || 50))
  const checkMchid = query.check_mchid
    ? String(query.check_mchid).trim()
    : getStockCreatorMchid()

  const result = await listStockMerchants({ stockId: id, offset, limit })
  if (!result.ok) {
    return adminResult(result.httpStatus === 404 ? 404 : 400, {
      error: result.error || '查询可用商户失败',
      detail: result.raw,
    })
  }

  const merchants = result.data || []
  let availableForMchid = merchants.includes(checkMchid)
  // If not on this page but total > page size, do a full scan when asking for our mchid
  if (!availableForMchid && checkMchid && result.totalCount > merchants.length) {
    const check = await isMchidAvailableForStock(id, checkMchid)
    if (check.ok) availableForMchid = check.available
  }

  return adminResult(200, {
    stock_id: result.stockId,
    merchants,
    total: result.totalCount,
    offset: result.offset,
    limit: result.limit,
    check_mchid: checkMchid || null,
    available_for_mchid: checkMchid ? availableForMchid : null,
  })
}

/**
 * List available goods codes for a stock:
 * GET /v3/marketing/favor/stocks/{stock_id}/items
 */
async function listAdminWxFavorStockItems(stockId, query = {}) {
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }
  const id = String(stockId || '').trim()
  if (!id) return adminResult(400, { error: '缺少 stock_id' })

  const offset = Math.max(0, parseInt(query.offset, 10) || 0)
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 100))
  const checkGoodsId = query.check_goods_id
    ? String(query.check_goods_id).trim()
    : ''

  const result = await listStockItems({ stockId: id, offset, limit })
  if (!result.ok) {
    return adminResult(result.httpStatus === 404 ? 404 : 400, {
      error: result.error || '查询可用商品编码失败',
      detail: result.raw,
    })
  }

  const items = result.data || []
  let unrestricted = result.unrestricted === true || result.totalCount === 0
  let availableForGoods = null

  if (checkGoodsId) {
    if (unrestricted) {
      availableForGoods = true
    } else if (items.includes(checkGoodsId)) {
      availableForGoods = true
    } else if (result.totalCount > items.length) {
      const check = await isGoodsIdAvailableForStock(id, checkGoodsId)
      if (check.ok) {
        availableForGoods = check.available
        unrestricted = Boolean(check.unrestricted) || unrestricted
      }
    } else {
      availableForGoods = false
    }
  }

  return adminResult(200, {
    stock_id: result.stockId,
    items,
    total: result.totalCount,
    offset: result.offset,
    limit: result.limit,
    unrestricted,
    check_goods_id: checkGoodsId || null,
    available_for_goods_id: availableForGoods,
  })
}

/**
 * Pull each local template's stock via getStock and sync wx_status.
 */
async function syncAdminCouponTemplatesFromWx() {
  await ensureReferralRewardsSchema()
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }

  const [localRows] = await db.query(
    `SELECT id, stock_id, stock_creator_mchid, wx_status FROM referral_coupon_templates
     WHERE stock_id IS NOT NULL AND stock_id <> ''`
  )
  if (!localRows.length) {
    return adminResult(200, { success: true, updated: 0, message: '本地无可同步模板' })
  }

  let updated = 0
  let checked = 0
  const errors = []

  for (const row of localRows) {
    const result = await getStock(
      row.stock_id,
      row.stock_creator_mchid || getStockCreatorMchid()
    )
    if (!result.ok) {
      errors.push({ stock_id: row.stock_id, error: result.error })
      continue
    }
    checked += 1
    const nextStatus = mapWxStockStatusToLocal(result.stock?.status)
    if (nextStatus && nextStatus !== row.wx_status) {
      await db.query(
        `UPDATE referral_coupon_templates
         SET wx_status = ?, updated_at = NOW()
         WHERE id = ?`,
        [nextStatus, row.id]
      )
      updated += 1
    }
  }

  return adminResult(200, {
    success: true,
    updated,
    checked,
    failed: errors.length,
    errors: errors.length ? errors.slice(0, 10) : undefined,
  })
}

/**
 * Query Favor marketing notify callback URL:
 * GET /v3/marketing/favor/callbacks
 */
async function getAdminFavorCallback() {
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }

  const result = await getFavorCallback()
  if (!result.ok) {
    return adminResult(result.httpStatus === 404 ? 404 : 400, {
      error: result.error || '查询回调地址失败',
      detail: result.raw,
    })
  }

  return adminResult(200, {
    mchid: result.mchid,
    notify_url: result.notifyUrl,
    unset: Boolean(result.unset),
    recommended_url: getDefaultFavorNotifyUrl(),
  })
}

/**
 * Set Favor marketing notify callback URL:
 * POST /v3/marketing/favor/callbacks
 */
async function setAdminFavorCallback(body = {}) {
  if (!isFavorConfigured()) {
    return adminResult(400, { error: '请先启用 WX_FAVOR_ENABLED 并配置微信支付证书' })
  }

  const notifyUrl = body.notify_url
    ? String(body.notify_url).trim()
    : getDefaultFavorNotifyUrl()

  const result = await setFavorCallback({ notifyUrl, switchOn: true })
  if (!result.ok) {
    return adminResult(400, {
      error: result.error || '设置回调地址失败',
      detail: result.raw,
    })
  }

  return adminResult(200, {
    success: true,
    notify_url: result.notifyUrl,
    update_time: result.updateTime,
  })
}

/**
 * Handle Favor coupon use notify (COUPON.USE).
 * Spec: verify signature → decrypt → idempotent update → HTTP 204.
 * Duplicate notifies and concurrent re-entry are safe.
 */
async function handleFavorCouponUseNotify(req) {
  const {
    parseAndVerifyWechatPayNotify,
    decryptWechatPayNotifyPayload,
    notifySuccessResult,
    notifyFailResult,
  } = require('../utils/wechatPayNotify')
  const redisClient = require('../utils/redisClient')

  const verified = parseAndVerifyWechatPayNotify(req)
  if (!verified.ok) {
    if (verified.signTest) {
      logger.warn('favor notify signature probe traffic (SIGNTEST)')
    }
    return notifyFailResult(verified.status, verified.error)
  }

  const { payload } = verified
  const notifyId = payload.id != null ? String(payload.id) : null
  const eventType = String(payload.event_type || '')

  if (eventType && eventType !== 'COUPON.USE') {
    logger.info('favor notify ignored event', { notifyId, eventType })
    return notifySuccessResult()
  }

  if (String(payload.resource_type || '') && payload.resource_type !== 'encrypt-resource') {
    logger.warn('favor notify unexpected resource_type', {
      notifyId,
      resourceType: payload.resource_type,
    })
  }

  if (!payload.resource) {
    return notifyFailResult(400, '回调数据格式错误')
  }

  // 通知 id 幂等：已处理过则直接成功应答
  if (notifyId) {
    try {
      const done = await redisClient.get(`favor:notify:done:${notifyId}`)
      if (done) {
        logger.info('favor notify already processed', { notifyId })
        return notifySuccessResult()
      }
    } catch (err) {
      logger.warn('favor notify redis done-check failed', { notifyId, err: err.message })
    }
  }

  let coupon
  try {
    coupon = decryptWechatPayNotifyPayload(payload)
  } catch (err) {
    logger.error('favor notify decrypt failed', { notifyId, err: err.message })
    return notifyFailResult(400, '解密失败')
  }

  const couponId = coupon?.coupon_id != null ? String(coupon.coupon_id) : null
  const stockId = coupon?.stock_id != null ? String(coupon.stock_id) : null
  const couponStatus = String(coupon?.status || '').toUpperCase()
  const consume = coupon?.consume_information || {}
  const transactionId = consume.transaction_id != null ? String(consume.transaction_id) : null

  logger.info('favor coupon use notify', {
    notifyId,
    couponId,
    stockId,
    status: couponStatus,
    consumeMchid: consume.consume_mchid || null,
    transactionId,
    consumeTime: consume.consume_time || null,
  })

  if (!couponId) {
    // 无券 id 无法落库，仍应答成功避免死循环；依赖查券接口对账
    logger.warn('favor notify missing coupon_id', { notifyId })
    return notifySuccessResult()
  }

  // 并发锁：同一 notify / coupon 仅一个处理中
  const lockKey = notifyId
    ? `favor:notify:lock:${notifyId}`
    : `favor:notify:lock:coupon:${couponId}`
  let lockAcquired = false
  try {
    lockAcquired = await redisClient.setNxEx(lockKey, 60, 'processing')
  } catch (err) {
    logger.warn('favor notify redis lock failed', { lockKey, err: err.message })
  }

  if (lockAcquired === false) {
    // 其他实例正在处理或刚完成：按已接收成功应答（重入安全）
    logger.info('favor notify lock not acquired, treat as duplicate', { notifyId, couponId })
    return notifySuccessResult()
  }

  try {
    await ensureReferralRewardsSchema()

    const [existing] = await db.query(
      `SELECT id, status FROM wx_favor_coupon_grants
       WHERE coupon_id = ?
       ORDER BY id DESC
       LIMIT 1`,
      [couponId]
    )
    const row = existing[0]

    if (row?.status === 'used') {
      logger.info('favor grant already used', { couponId, grantId: row.id })
    } else if (couponStatus === 'USED' || couponStatus === '' || Boolean(consume.consume_time)) {
      const [result] = await db.query(
        `UPDATE wx_favor_coupon_grants
         SET status = 'used', updated_at = NOW()
         WHERE coupon_id = ? AND status = 'sent'`,
        [couponId]
      )
      logger.info('favor grant marked used', {
        couponId,
        grantId: row?.id || null,
        transactionId,
        affected: result?.affectedRows || 0,
      })
    } else {
      logger.info('favor notify coupon not in USED state, skip mark', {
        couponId,
        status: couponStatus,
      })
    }

    if (notifyId) {
      try {
        await redisClient.setEx(`favor:notify:done:${notifyId}`, 7 * 24 * 3600, '1')
      } catch (err) {
        logger.warn('favor notify redis done-mark failed', { notifyId, err: err.message })
      }
    }
  } catch (err) {
    logger.error('favor grant mark used failed', { couponId, err: err.message })
    try {
      await redisClient.del(lockKey)
    } catch {
      /* ignore */
    }
    return notifyFailResult(500, '更新本地发放记录失败')
  }

  return notifySuccessResult()
}

/**
 * 支付查单/回调 promotion_detail 补齐：将核销的券标记为 used（免充值券 notify 的兜底）。
 */
async function markFavorGrantsUsedFromPromotionDetail(promotionDetail, { transactionId = null } = {}) {
  if (!Array.isArray(promotionDetail) || !promotionDetail.length) {
    return { marked: 0 }
  }

  await ensureReferralRewardsSchema()
  let marked = 0

  for (const item of promotionDetail) {
    const couponId = item?.coupon_id != null ? String(item.coupon_id) : null
    if (!couponId) continue

    try {
      const [result] = await db.query(
        `UPDATE wx_favor_coupon_grants
         SET status = 'used', updated_at = NOW()
         WHERE coupon_id = ? AND status = 'sent'`,
        [couponId]
      )
      const n = result?.affectedRows || 0
      if (n > 0) {
        marked += n
        logger.info('favor grant marked used from promotion_detail', {
          couponId,
          stockId: item.stock_id != null ? String(item.stock_id) : null,
          amount_fen: item.amount != null ? Number(item.amount) : null,
          type: item.type || null,
          transactionId,
        })
      }
    } catch (err) {
      logger.warn('mark favor grant from promotion_detail failed', {
        couponId,
        err: err?.message || err,
      })
    }
  }

  return { marked }
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

const BATCH_GRANT_MAX_USERS = Math.max(
  1,
  Math.min(parseInt(process.env.WX_FAVOR_BATCH_GRANT_MAX || '500', 10) || 500, 2000),
)
const GRANT_ALL_MAX_USERS = Math.max(
  BATCH_GRANT_MAX_USERS,
  Math.min(parseInt(process.env.WX_FAVOR_GRANT_ALL_MAX || '10000', 10) || 10000, 50000),
)
const BATCH_GRANT_GAP_MS = Math.max(
  0,
  parseInt(process.env.WX_FAVOR_BATCH_GRANT_GAP_MS || '50', 10) || 0,
)
const BATCH_GRANT_RESULT_FAIL_LIMIT = 200

function parseBatchUserIds(raw) {
  let parts = []
  if (Array.isArray(raw)) {
    parts = raw
  } else if (typeof raw === 'string') {
    parts = raw.split(/[\s,;，；]+/)
  } else if (raw != null) {
    parts = [raw]
  }

  const seen = new Set()
  const userIds = []
  for (const part of parts) {
    const uid = parseInt(String(part).trim(), 10)
    if (Number.isNaN(uid) || uid <= 0) continue
    if (seen.has(uid)) continue
    seen.add(uid)
    userIds.push(uid)
  }
  return userIds
}

function sleepMs(ms) {
  if (!ms || ms <= 0) return Promise.resolve()
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function countFavorGrantEligibleUsers() {
  const [rows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM wx_users
     WHERE openid IS NOT NULL AND TRIM(openid) <> ''`
  )
  return Number(rows?.[0]?.total || 0)
}

async function listFavorGrantEligibleUserIds({ limit = GRANT_ALL_MAX_USERS } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || GRANT_ALL_MAX_USERS, GRANT_ALL_MAX_USERS))
  const [rows] = await db.query(
    `SELECT id
     FROM wx_users
     WHERE openid IS NOT NULL AND TRIM(openid) <> ''
     ORDER BY id ASC
     LIMIT ?`,
    [safeLimit]
  )
  return (rows || []).map((row) => Number(row.id)).filter((id) => id > 0)
}

async function loadRunningCouponTemplate(templateId) {
  const tid = parseInt(templateId, 10)
  if (Number.isNaN(tid) || tid <= 0) {
    return { error: adminResult(400, { error: '请选择优惠券模板' }) }
  }

  const [templates] = await db.query(
    `SELECT id, title, discount_yuan, min_order_yuan, valid_days, stock_id,
            stock_creator_mchid, wx_status, is_active
     FROM referral_coupon_templates
     WHERE id = ? AND is_active = 1 LIMIT 1`,
    [tid]
  )
  if (!templates.length) return { error: adminResult(404, { error: '优惠券模板不存在' }) }

  const tpl = templates[0]
  if (!tpl.stock_id || tpl.wx_status !== 'running') {
    return { error: adminResult(400, { error: '模板批次未激活，无法发放' }) }
  }
  return { template: tpl, templateId: tid }
}

async function runFavorGrantForUserIds({ userIds, template, templateId, source }) {
  const results = []
  let successCount = 0
  let failedCount = 0

  for (let i = 0; i < userIds.length; i += 1) {
    const uid = userIds[i]
    try {
      const result = await sendFavorCouponToUser({
        userId: uid,
        template,
        source,
      })
      if (result.ok) {
        successCount += 1
        results.push({
          user_id: uid,
          ok: true,
          coupon_id: result.coupon_id,
          stock_id: result.stock_id,
          out_request_no: result.out_request_no,
        })
      } else {
        failedCount += 1
        results.push({
          user_id: uid,
          ok: false,
          error: result.error || '发放失败',
          code: result.code || null,
        })
      }
    } catch (err) {
      failedCount += 1
      results.push({
        user_id: uid,
        ok: false,
        error: err?.message || '发放异常',
      })
      logger.warn('batch grant coupon item failed', {
        userId: uid,
        templateId,
        err: err?.message || err,
      })
    }

    if (i < userIds.length - 1 && BATCH_GRANT_GAP_MS > 0) {
      await sleepMs(BATCH_GRANT_GAP_MS)
    }
  }

  const failures = results.filter((row) => !row.ok)
  return {
    success: true,
    template_id: templateId,
    stock_id: template.stock_id,
    total: userIds.length,
    success_count: successCount,
    failed_count: failedCount,
    results: failures.slice(0, BATCH_GRANT_RESULT_FAIL_LIMIT),
    results_truncated: failures.length > BATCH_GRANT_RESULT_FAIL_LIMIT,
  }
}

/**
 * 批量向用户发放微信免充值代金券（逐个调用微信发券接口）。
 * - 指定用户：user_ids / user_ids_text
 * - 全部用户：grant_all=true（仅 openid 非空；需 confirm_grant_all=true）
 */
async function grantCouponToUsersBatch({
  userIds,
  userIdsText,
  templateId,
  grantAll = false,
  confirmGrantAll = false,
  source = 'admin',
} = {}) {
  await ensureReferralRewardsSchema()

  const loaded = await loadRunningCouponTemplate(templateId)
  if (loaded.error) return loaded.error
  const { template: tpl, templateId: tid } = loaded

  let ids = []
  let mode = 'selected'

  if (grantAll === true || grantAll === 'true' || grantAll === 1 || grantAll === '1') {
    if (!(confirmGrantAll === true || confirmGrantAll === 'true' || confirmGrantAll === 1 || confirmGrantAll === '1')) {
      return adminResult(400, { error: '发放给全部用户需确认 confirm_grant_all=true' })
    }
    mode = 'all'
    const eligibleCount = await countFavorGrantEligibleUsers()
    if (eligibleCount <= 0) {
      return adminResult(400, { error: '没有可发放的用户（需已绑定 openid）' })
    }
    if (eligibleCount > GRANT_ALL_MAX_USERS) {
      return adminResult(400, {
        error: `可发放用户超过上限 ${GRANT_ALL_MAX_USERS}，请提高 WX_FAVOR_GRANT_ALL_MAX 或分批发放`,
        max: GRANT_ALL_MAX_USERS,
        eligible_count: eligibleCount,
      })
    }
    ids = await listFavorGrantEligibleUserIds({ limit: GRANT_ALL_MAX_USERS })
  } else {
    ids = parseBatchUserIds(
      Array.isArray(userIds) && userIds.length ? userIds : userIdsText,
    )
    if (!ids.length) {
      return adminResult(400, { error: '请至少选择一个用户' })
    }
    if (ids.length > BATCH_GRANT_MAX_USERS) {
      return adminResult(400, {
        error: `单次最多发放 ${BATCH_GRANT_MAX_USERS} 个用户`,
        max: BATCH_GRANT_MAX_USERS,
        submitted: ids.length,
      })
    }
  }

  const body = await runFavorGrantForUserIds({
    userIds: ids,
    template: tpl,
    templateId: tid,
    source,
  })
  body.mode = mode
  return adminResult(200, body)
}

async function getFavorGrantEligibleCount() {
  const count = await countFavorGrantEligibleUsers()
  return adminResult(200, {
    eligible_count: count,
    grant_all_max: GRANT_ALL_MAX_USERS,
    batch_max: BATCH_GRANT_MAX_USERS,
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
  if (!orderId) return { cancelled: 0, debt_added: 0 }

  const { clawbackWithdrawnAmount } = require('./commissionService')

  const [rows] = await connection.query(
    `SELECT id, user_id, amount, status
     FROM referral_bonus_grants
     WHERE order_id = ? AND status IN ('settlable', 'withdrawn')`,
    [orderId]
  )

  let cancelled = 0
  let debtAdded = 0
  for (const row of rows || []) {
    const amount = parseMoney(row.amount)
    if (row.status === 'settlable') {
      await adjustWalletBalances(row.user_id, {
        availableDelta: -amount,
        earnedDelta: -amount,
      }, connection)
    } else if (row.status === 'withdrawn') {
      const claw = await clawbackWithdrawnAmount(row.user_id, amount, {
        orderId,
        sourceType: 'bonus',
        sourceId: row.id,
        reason: 'order_refund',
        connection,
      })
      debtAdded = roundMoney(debtAdded + claw.debtAdd)
    }
    await connection.query(
      `UPDATE referral_bonus_grants SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    cancelled += 1
  }

  return { cancelled, debt_added: debtAdded }
}

module.exports = {
  adminResult,
  FIRST_REFERRAL_BONUS_YUAN,
  NEW_USER_COUPON_YUAN,
  BONUS_TYPE_FIRST_REFERRAL,
  tryGrantNewUserWelcomeCoupon,
  tryGrantFirstReferralOrderBonus,
  listUserCoupons,
  getUserCouponDetail,
  getAdminUserCouponDetail,
  evaluateReferralCouponApplicability,
  resolveReferralCouponDiscount,
  reserveReferralCouponForOrder,
  syncReferralCouponForOrder,
  markReferralCouponUsed,
  releaseReferralCouponByOrderId,
  cancelBonusGrantsByOrderId,
  listAdminCouponTemplates,
  createAdminCouponTemplate,
  startAdminCouponTemplate,
  pauseAdminCouponTemplate,
  restartAdminCouponTemplate,
  listAdminWxFavorStocks,
  getAdminWxFavorStock,
  listAdminWxFavorStockMerchants,
  listAdminWxFavorStockItems,
  syncAdminCouponTemplatesFromWx,
  getAdminFavorCallback,
  setAdminFavorCallback,
  handleFavorCouponUseNotify,
  markFavorGrantsUsedFromPromotionDetail,
  grantCouponToUser,
  grantCouponToUsersBatch,
  getFavorGrantEligibleCount,
  listAdminUserCoupons,
}
