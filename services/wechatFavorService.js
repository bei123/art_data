const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const logger = require('../utils/logger')

const WX_PAY_CONFIG = {
  appId: process.env.WX_APPID,
  mchId: process.env.WX_PAY_MCH_ID,
  serialNo: process.env.WX_PAY_SERIAL_NO,
  publicKeyId: process.env.WX_PUB_ID,
  privateKey: (() => {
    try {
      return fs.readFileSync(path.join(__dirname, '../ssl/apiclient_key.pem'))
    } catch {
      return null
    }
  })(),
}

function isFavorEnabled() {
  return String(process.env.WX_FAVOR_ENABLED || 'false').toLowerCase() === 'true'
}

function getStockCreatorMchid() {
  return String(process.env.WX_FAVOR_STOCK_CREATOR_MCHID || WX_PAY_CONFIG.mchId || '').trim()
}

function isFavorConfigured() {
  return Boolean(
    isFavorEnabled()
    && WX_PAY_CONFIG.appId
    && WX_PAY_CONFIG.mchId
    && WX_PAY_CONFIG.serialNo
    && WX_PAY_CONFIG.publicKeyId
    && WX_PAY_CONFIG.privateKey
    && getStockCreatorMchid()
  )
}

function generateNonceStr() {
  return Math.random().toString(36).substring(2, 17)
}

function generateSignV3(method, urlPath, timestamp, nonceStr, body) {
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  return sign.sign(WX_PAY_CONFIG.privateKey, 'base64')
}

function buildAuthHeaders(method, urlPath, bodyObj) {
  const body = bodyObj == null ? '' : JSON.stringify(bodyObj)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = generateNonceStr()
  const signature = generateSignV3(method, urlPath, timestamp, nonceStr, body)
  return {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
      'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
    },
    body,
  }
}

async function signedRequest(method, urlPath, bodyObj) {
  const { headers } = buildAuthHeaders(method, urlPath, bodyObj)
  const url = `https://api.mch.weixin.qq.com${urlPath}`
  const config = {
    method,
    url,
    headers,
    timeout: 20000,
    validateStatus: () => true,
  }
  if (method !== 'GET' && bodyObj != null) config.data = bodyObj
  const response = await axios(config)
  return { status: response.status, data: response.data }
}

function yuanToCents(yuan) {
  return Math.round(Number(yuan) * 100)
}

/** Format instant as China local time with +08:00 (WeChat Favor requires rfc3339 + TIMEZONE). */
function formatRfc3339(date) {
  const d = date instanceof Date ? date : new Date(date)
  const chinaMs = d.getTime() + 8 * 60 * 60 * 1000
  const china = new Date(chinaMs)
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  const y = china.getUTCFullYear()
  const m = pad(china.getUTCMonth() + 1)
  const day = pad(china.getUTCDate())
  const h = pad(china.getUTCHours())
  const min = pad(china.getUTCMinutes())
  const s = pad(china.getUTCSeconds())
  const ms = pad(china.getUTCMilliseconds(), 3)
  return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}+08:00`
}

function clampMaxCoupons(value) {
  const n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 5) return 5
  if (n > 10000000) return 10000000
  return n
}

function clampMaxCouponsPerUser(value, maxCoupons) {
  let n = parseInt(value, 10)
  if (Number.isNaN(n) || n < 1) n = 1
  if (n > 60) n = 60
  if (n > maxCoupons) n = maxCoupons
  return n
}

function buildOutRequestNo({ prefix = 'F', userId = 0, stockId = '' } = {}) {
  const mch = getStockCreatorMchid() || '0'
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const nonce = crypto.randomBytes(4).toString('hex')
  const uid = userId ? String(userId) : '0'
  const sid = stockId ? String(stockId).slice(-8) : '0'
  return `${mch}${day}${prefix}${uid}${sid}${nonce}`.slice(0, 128)
}

function sanitizeStockName(title) {
  const raw = String(title || '优惠券').replace(/[_,;|]/g, '').trim()
  const chars = Array.from(raw)
  if (chars.length <= 9) return chars.join('') || '优惠券'
  return chars.slice(0, 9).join('')
}

function wxErrorMessage(data) {
  if (!data || typeof data !== 'object') return '微信支付营销接口失败'
  const parts = [data.code, data.message || data.detail].filter(Boolean)
  return parts.length ? parts.join(': ') : '微信支付营销接口失败'
}

/** Friendlier messages for send-coupon business errors (docs 2024.09.19). */
function mapSendCouponError(data) {
  const code = String(data?.code || '')
  const message = String(data?.message || data?.detail || '')
  const combined = `${code} ${message}`

  if (combined.includes('限领') || combined.includes('最大领券') || code === 'RULE_LIMIT') {
    return '用户已达该批次领取上限'
  }
  if (combined.includes('未实名')) return '用户未实名，无法领券'
  if (combined.includes('用户非法') || code === 'USER_ACCOUNT_ABNORMAL') {
    return '用户账号异常，无法领券'
  }
  if (combined.includes('预算') || combined.includes('单天限额') || combined.includes('余额不足')) {
    return message || '批次预算不足，无法发券'
  }
  if (combined.includes('未激活') || combined.includes('已结束') || combined.includes('非法的批次状态')) {
    return '批次未在运营中，无法发券'
  }
  if (combined.includes('无权发券') || combined.includes('跨商户')) {
    return '商户无权发放该批次'
  }
  if (combined.includes('OpenID与AppID')) return 'OpenID 与 AppID 不匹配'
  if (combined.includes('AppID') && code === 'APPID_MCHID_NOT_MATCH') {
    return '商户号与 AppID 未绑定'
  }
  return wxErrorMessage(data)
}

/**
 * Create a no-cash (免充值) NORMAL coupon stock and return stock_id.
 * Spec: POST /v3/marketing/favor/coupon-stocks
 */
async function createCouponStock({
  title,
  discountYuan,
  minOrderYuan = 0,
  validDays = 30,
  maxCoupons = 10000,
  maxCouponsPerUser = 1,
  comment = '',
}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }

  const couponAmount = yuanToCents(discountYuan)
  const minOrderCents = yuanToCents(minOrderYuan)
  // 门槛须大于面额（门槛 - 面额 >= 0.01 元）
  const transactionMinimum = Math.max(couponAmount + 1, minOrderCents > 0 ? minOrderCents : couponAmount + 1)

  if (couponAmount < 10 || couponAmount > 100000) {
    return { ok: false, error: '优惠面额需在 0.1～1000 元之间（微信限制）' }
  }
  if (transactionMinimum <= couponAmount) {
    return { ok: false, error: '使用门槛须大于优惠面额' }
  }

  const cappedMaxCoupons = clampMaxCoupons(maxCoupons)
  const cappedPerUser = clampMaxCouponsPerUser(maxCouponsPerUser, cappedMaxCoupons)

  // 可用时间范围最长 90 天；开始时间不可早于当前时间
  const days = Math.min(90, Math.max(1, parseInt(validDays, 10) || 30))
  const begin = new Date(Date.now() + 3 * 60 * 1000)
  const end = new Date(begin.getTime() + days * 24 * 60 * 60 * 1000)

  const mchid = getStockCreatorMchid()
  const maxAmount = couponAmount * cappedMaxCoupons
  const outRequestNo = buildOutRequestNo({ prefix: 'C' })
  const appId = process.env.WX_APPID || ''

  const body = {
    stock_name: sanitizeStockName(title),
    comment: String(comment || title || '营销活动').slice(0, 60),
    belong_merchant: mchid,
    available_begin_time: formatRfc3339(begin),
    available_end_time: formatRfc3339(end),
    stock_use_rule: {
      max_coupons: cappedMaxCoupons,
      max_amount: maxAmount,
      max_coupons_per_user: cappedPerUser,
      natural_person_limit: false,
      prevent_api_abuse: true,
    },
    coupon_use_rule: {
      fixed_normal_coupon: {
        coupon_amount: couponAmount,
        transaction_minimum: transactionMinimum,
      },
      available_merchants: [mchid],
      // 小程序支付可核销；不传则默认不限
      trade_type: ['MICROAPP'],
    },
    no_cash: true,
    stock_type: 'NORMAL',
    out_request_no: outRequestNo,
  }

  if (appId) {
    body.pattern_info = {
      description: String(comment || title || '微信支付代金券，下单支付时自动抵扣').slice(0, 1000),
      jump_target: 'MINI_PROGRAM',
      mini_program_appid: appId,
      mini_program_path: 'pages/my/coupons',
      background_color: 'COLOR060',
    }
  }

  const result = await signedRequest('POST', '/v3/marketing/favor/coupon-stocks', body)
  if (result.status === 200 || result.status === 201) {
    const stockId = String(result.data?.stock_id || '')
    if (!stockId) {
      return { ok: false, error: '创建批次成功但未返回 stock_id', raw: result.data }
    }
    return {
      ok: true,
      stockId,
      stockCreatorMchid: mchid,
      outRequestNo,
      availableBeginTime: body.available_begin_time,
      availableEndTime: body.available_end_time,
      raw: result.data,
    }
  }

  logger.error('createCouponStock failed', { status: result.status, data: result.data, body })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isStartStockRetryable(result) {
  if (!result || result.ok) return false
  const msg = String(result.error || result.raw?.message || '')
  // 官方：创建后马上激活可能失败，需稍后重试（幂等可重入）
  return (
    msg.includes('卡包信息尚未注册完成')
    || msg.includes('批次规则尚未同步完成')
    || msg.includes('请稍后重试')
    || result.code === 'SYSTEM_ERROR'
    || result.httpStatus === 429
  )
}

/**
 * Activate stock: POST /v3/marketing/favor/stocks/{stock_id}/start
 * Body: { stock_creator_mchid }
 */
async function startStockOnce(stockId, stockCreatorMchid = getStockCreatorMchid()) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}/start`
  const body = { stock_creator_mchid: mchid }
  const result = await signedRequest('POST', urlPath, body)

  if (result.status === 200 || result.status === 204) {
    return {
      ok: true,
      stockId: result.data?.stock_id != null ? String(result.data.stock_id) : id,
      startTime: result.data?.start_time || null,
      raw: result.data || null,
    }
  }

  // 已激活等幂等场景：部分环境下会返回业务错误，按消息兜底
  const msg = wxErrorMessage(result.data)
  if (
    String(msg).includes('已激活')
    || String(msg).includes('已经激活')
    || String(msg).includes('批次状态')
  ) {
    logger.warn('startStock treated as possibly already running', { stockId: id, data: result.data })
  }

  logger.error('startStock failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: msg,
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
    retryable: false,
  }
}

async function startStock(stockId, stockCreatorMchid = getStockCreatorMchid(), options = {}) {
  const maxAttempts = Math.max(1, parseInt(options.maxAttempts, 10) || 1)
  const delayMs = Math.max(500, parseInt(options.delayMs, 10) || 2000)
  let last = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await startStockOnce(stockId, stockCreatorMchid)
    last.attempt = attempt
    if (last.ok) return last

    last.retryable = isStartStockRetryable(last)
    if (!last.retryable || attempt >= maxAttempts) break

    logger.warn('startStock retryable failure, waiting', {
      stockId,
      attempt,
      delayMs,
      error: last.error,
    })
    await sleep(delayMs)
  }

  return last
}

/** Create-then-activate helper with delayed retries (WeChat sync lag). */
async function startStockWithRetry(stockId, stockCreatorMchid = getStockCreatorMchid()) {
  // 官方：创建后不可马上激活（卡包/规则同步），先等待再重试；接口支持幂等重入
  await sleep(2500)
  let last = null
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    last = await startStockOnce(stockId, stockCreatorMchid)
    last.attempt = attempt
    if (last.ok) return last
    last.retryable = isStartStockRetryable(last)
    if (!last.retryable || attempt >= 3) break
    logger.warn('startStockWithRetry waiting', { stockId, attempt, error: last.error })
    await sleep(2500)
  }
  return last
}

/**
 * Send coupon to user: POST /v3/marketing/favor/users/{openid}/coupons
 *
 * Body: stock_id, out_request_no, appid, stock_creator_mchid
 * Do NOT pass coupon_value / coupon_minimum for normal stocks (字段暂未开放 / 常规勿传).
 * Idempotent on out_request_no.
 */
async function sendCoupon({
  openid,
  stockId,
  stockCreatorMchid = getStockCreatorMchid(),
  outRequestNo,
  appid = WX_PAY_CONFIG.appId,
  userId = 0,
} = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const oid = String(openid || '').trim()
  const sid = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  const aid = String(appid || WX_PAY_CONFIG.appId || '').trim()

  if (!oid) return { ok: false, error: '缺少 openid' }
  if (!sid) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }
  if (!aid) return { ok: false, error: '缺少 appid' }

  const reqNo = String(
    outRequestNo
    || buildOutRequestNo({ prefix: 'S', userId, stockId: sid })
  ).slice(0, 128)

  const urlPath = `/v3/marketing/favor/users/${encodeURIComponent(oid)}/coupons`
  const body = {
    stock_id: sid,
    out_request_no: reqNo,
    appid: aid,
    stock_creator_mchid: mchid,
  }

  const result = await signedRequest('POST', urlPath, body)
  if (result.status === 200) {
    return {
      ok: true,
      couponId: result.data?.coupon_id != null ? String(result.data.coupon_id) : null,
      outRequestNo: reqNo,
      raw: result.data,
    }
  }

  logger.error('sendCoupon failed', {
    openid: oid,
    stockId: sid,
    status: result.status,
    data: result.data,
  })
  return {
    ok: false,
    error: mapSendCouponError(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    outRequestNo: reqNo,
    raw: result.data,
  }
}

/**
 * List user coupons: GET /v3/marketing/favor/users/{openid}/coupons
 *
 * creator_mchid 与 available_mchid 二选一（同时传时微信优先 creator_mchid）。
 * - creator_mchid：可按 status/offset/limit/stock_id 查（除过期外）
 * - available_mchid：仅返回可用券，status/offset/limit/stock_id 不生效
 */
async function listUserCoupons({
  openid,
  appid = WX_PAY_CONFIG.appId,
  stockId,
  status,
  businessType,
  creatorMchid,
  availableMchid,
  offset = 0,
  limit = 20,
  /** 'creator' | 'available' — default creator when neither mchid explicitly chosen */
  queryBy = 'creator',
} = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const oid = String(openid || '').trim()
  if (!oid) return { ok: false, error: '缺少 openid' }
  if (!appid) return { ok: false, error: '缺少 appid' }

  const params = new URLSearchParams()
  params.set('appid', String(appid))

  const useAvailable = queryBy === 'available'
    || (availableMchid && !creatorMchid && queryBy !== 'creator')

  if (useAvailable) {
    const mch = String(availableMchid || getStockCreatorMchid() || '').trim()
    if (!mch) return { ok: false, error: '缺少 available_mchid' }
    params.set('available_mchid', mch)
  } else {
    const mch = String(creatorMchid || getStockCreatorMchid() || '').trim()
    if (!mch) return { ok: false, error: '缺少 creator_mchid' }
    params.set('creator_mchid', mch)
    const pageOffset = Math.max(0, parseInt(offset, 10) || 0)
    const pageLimit = Math.min(50, Math.max(1, parseInt(limit, 10) || 20))
    params.set('offset', String(pageOffset))
    params.set('limit', String(pageLimit))
    if (stockId) params.set('stock_id', String(stockId))
    if (status) params.set('status', String(status).toUpperCase())
  }

  if (businessType) params.set('business_type', String(businessType))

  const urlPath = `/v3/marketing/favor/users/${encodeURIComponent(oid)}/coupons?${params.toString()}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    const data = result.data || {}
    return {
      ok: true,
      totalCount: Number(data.total_count || 0),
      offset: data.offset != null ? Number(data.offset) : null,
      limit: data.limit != null ? Number(data.limit) : null,
      data: Array.isArray(data.data) ? data.data : [],
      raw: data,
    }
  }

  logger.error('listUserCoupons failed', { openid: oid, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

/**
 * Query one user coupon: GET /v3/marketing/favor/users/{openid}/coupons/{coupon_id}
 * Query: appid (required)
 */
async function getCoupon({ openid, couponId, appid = WX_PAY_CONFIG.appId } = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const oid = String(openid || '').trim()
  const cid = String(couponId || '').trim()
  const aid = String(appid || WX_PAY_CONFIG.appId || '').trim()
  if (!oid) return { ok: false, error: '缺少 openid' }
  if (!cid) return { ok: false, error: '缺少 coupon_id' }
  if (!aid) return { ok: false, error: '缺少 appid' }

  const params = new URLSearchParams({ appid: aid })
  const urlPath = `/v3/marketing/favor/users/${encodeURIComponent(oid)}/coupons/${encodeURIComponent(cid)}?${params}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    return { ok: true, coupon: result.data || null, raw: result.data }
  }

  logger.error('getCoupon failed', {
    openid: oid,
    couponId: cid,
    status: result.status,
    data: result.data,
  })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

function mapFavorCouponToClient(item) {
  if (!item || typeof item !== 'object') return null
  const normal = item.normal_coupon_information || {}
  const amountCents = Number(normal.coupon_amount != null ? normal.coupon_amount : item.coupon_amount || 0)
  const minCents = Number(normal.transaction_minimum != null ? normal.transaction_minimum : 0)
  return {
    coupon_id: item.coupon_id != null ? String(item.coupon_id) : null,
    stock_id: item.stock_id != null ? String(item.stock_id) : null,
    stock_creator_mchid: item.stock_creator_mchid || null,
    title: item.coupon_name || item.description || item.stock_name || '代金券',
    description: item.description || null,
    discount_yuan: Math.round(amountCents) / 100,
    min_order_yuan: Math.round(minCents) / 100,
    status: item.status || null,
    coupon_type: item.coupon_type || null,
    no_cash: item.no_cash,
    singleitem: item.singleitem,
    available_begin_time: item.available_begin_time || null,
    available_end_time: item.available_end_time || null,
    create_time: item.create_time || null,
    out_request_no: item.out_request_no || null,
  }
}

/**
 * Pause stock: POST /v3/marketing/favor/stocks/{stock_id}/pause
 * After pause, users cannot claim this stock via any channel.
 */
async function pauseStock(stockId, stockCreatorMchid = getStockCreatorMchid()) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}/pause`
  const body = { stock_creator_mchid: mchid }
  const result = await signedRequest('POST', urlPath, body)

  if (result.status === 200 || result.status === 204) {
    return {
      ok: true,
      stockId: result.data?.stock_id != null ? String(result.data.stock_id) : id,
      pauseTime: result.data?.pause_time || null,
      raw: result.data || null,
    }
  }

  logger.error('pauseStock failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

/**
 * Restart paused stock: POST /v3/marketing/favor/stocks/{stock_id}/restart
 * Response: { restart_time, stock_id }. Supports idempotent re-entry.
 */
async function restartStockOnce(stockId, stockCreatorMchid = getStockCreatorMchid()) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}/restart`
  const body = { stock_creator_mchid: mchid }
  const result = await signedRequest('POST', urlPath, body)

  if (result.status === 200 || result.status === 204) {
    return {
      ok: true,
      stockId: result.data?.stock_id != null ? String(result.data.stock_id) : id,
      restartTime: result.data?.restart_time || null,
      raw: result.data || null,
    }
  }

  logger.error('restartStock failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

async function restartStock(stockId, stockCreatorMchid = getStockCreatorMchid(), options = {}) {
  const maxAttempts = Math.max(1, parseInt(options.maxAttempts, 10) || 3)
  const delayMs = Math.max(500, parseInt(options.delayMs, 10) || 2500)
  let last = null

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    last = await restartStockOnce(stockId, stockCreatorMchid)
    last.attempt = attempt
    if (last.ok) return last

    // 官方：批次规则尚未同步完成，请稍后重试
    const retryable = isStartStockRetryable(last) || String(last.error || '').includes('尚未同步')
    last.retryable = retryable
    if (!retryable || attempt >= maxAttempts) break

    logger.warn('restartStock retryable failure, waiting', {
      stockId,
      attempt,
      delayMs,
      error: last.error,
    })
    await sleep(delayMs)
  }

  return last
}

/**
 * List stocks: GET /v3/marketing/favor/stocks
 * Query: offset, limit(max 10), stock_creator_mchid, status?, create_start_time?, create_end_time?
 */
async function listStocks({
  offset = 0,
  limit = 10,
  stockCreatorMchid = getStockCreatorMchid(),
  status,
  createStartTime,
  createEndTime,
} = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const pageSize = Math.min(10, Math.max(1, parseInt(limit, 10) || 10))
  const pageOffset = Math.max(0, parseInt(offset, 10) || 0)

  const params = new URLSearchParams()
  params.set('offset', String(pageOffset))
  params.set('limit', String(pageSize))
  params.set('stock_creator_mchid', mchid)
  if (status) params.set('status', String(status))
  if (createStartTime) params.set('create_start_time', String(createStartTime))
  if (createEndTime) params.set('create_end_time', String(createEndTime))

  const urlPath = `/v3/marketing/favor/stocks?${params.toString()}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    const data = result.data || {}
    return {
      ok: true,
      totalCount: Number(data.total_count || 0),
      offset: Number(data.offset != null ? data.offset : pageOffset),
      limit: Number(data.limit != null ? data.limit : pageSize),
      data: Array.isArray(data.data) ? data.data : [],
      raw: data,
    }
  }

  logger.error('listStocks failed', { status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

/**
 * Query single stock: GET /v3/marketing/favor/stocks/{stock_id}
 * Query: stock_creator_mchid (required)
 */
async function getStock(stockId, stockCreatorMchid = getStockCreatorMchid()) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const params = new URLSearchParams({ stock_creator_mchid: mchid })
  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}?${params}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    return { ok: true, stock: result.data || null, raw: result.data }
  }

  logger.error('getStock failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

/**
 * List available merchants for a stock:
 * GET /v3/marketing/favor/stocks/{stock_id}/merchants
 * Query: offset, limit(max 50), stock_creator_mchid
 */
async function listStockMerchants({
  stockId,
  offset = 0,
  limit = 50,
  stockCreatorMchid = getStockCreatorMchid(),
} = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const pageSize = Math.min(50, Math.max(1, parseInt(limit, 10) || 50))
  const pageOffset = Math.max(0, Math.min(1000, parseInt(offset, 10) || 0))

  const params = new URLSearchParams()
  params.set('offset', String(pageOffset))
  params.set('limit', String(pageSize))
  params.set('stock_creator_mchid', mchid)

  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}/merchants?${params}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    const data = result.data || {}
    const merchants = Array.isArray(data.data)
      ? data.data.map((m) => String(m)).filter(Boolean)
      : []
    return {
      ok: true,
      stockId: data.stock_id != null ? String(data.stock_id) : id,
      totalCount: Number(data.total_count || 0),
      offset: Number(data.offset != null ? data.offset : pageOffset),
      limit: Number(data.limit != null ? data.limit : pageSize),
      data: merchants,
      raw: data,
    }
  }

  logger.error('listStockMerchants failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

/**
 * Check whether a mchid appears in the stock's available merchant list.
 * Paginates until found or exhausted (cap 20 pages / 1000 merchants).
 */
async function isMchidAvailableForStock(
  stockId,
  mchid = getStockCreatorMchid(),
  stockCreatorMchid = getStockCreatorMchid()
) {
  const target = String(mchid || '').trim()
  if (!target) return { ok: false, error: '缺少商户号', available: false }

  let offset = 0
  let total = Infinity
  const pageLimit = 50
  const maxOffset = 1000

  while (offset < total && offset <= maxOffset) {
    const page = await listStockMerchants({
      stockId,
      offset,
      limit: pageLimit,
      stockCreatorMchid,
    })
    if (!page.ok) return { ...page, available: false }

    total = page.totalCount
    if (page.data.includes(target)) {
      return { ok: true, available: true, totalCount: total, stockId: page.stockId }
    }
    if (!page.data.length) break
    offset += pageLimit
  }

  return {
    ok: true,
    available: false,
    totalCount: Number.isFinite(total) ? total : 0,
    stockId: String(stockId || ''),
  }
}

/**
 * List available goods codes for a stock:
 * GET /v3/marketing/favor/stocks/{stock_id}/items
 * Query: offset, limit(max 100), stock_creator_mchid
 * Empty list usually means whole-store coupon (非单品限制).
 */
async function listStockItems({
  stockId,
  offset = 0,
  limit = 100,
  stockCreatorMchid = getStockCreatorMchid(),
} = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  const mchid = String(stockCreatorMchid || getStockCreatorMchid() || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }
  if (!mchid) return { ok: false, error: '缺少 stock_creator_mchid' }

  const pageSize = Math.min(100, Math.max(1, parseInt(limit, 10) || 100))
  const pageOffset = Math.max(0, Math.min(500, parseInt(offset, 10) || 0))

  const params = new URLSearchParams()
  params.set('offset', String(pageOffset))
  params.set('limit', String(pageSize))
  params.set('stock_creator_mchid', mchid)

  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}/items?${params}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    const data = result.data || {}
    const items = Array.isArray(data.data)
      ? data.data.map((m) => String(m)).filter(Boolean)
      : []
    return {
      ok: true,
      stockId: data.stock_id != null ? String(data.stock_id) : id,
      totalCount: Number(data.total_count || 0),
      offset: Number(data.offset != null ? data.offset : pageOffset),
      limit: Number(data.limit != null ? data.limit : pageSize),
      data: items,
      raw: data,
    }
  }

  logger.error('listStockItems failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

/**
 * Check whether a goods_id appears in the stock's available item list.
 * Paginates until found or exhausted (cap offset 500).
 */
async function isGoodsIdAvailableForStock(
  stockId,
  goodsId,
  stockCreatorMchid = getStockCreatorMchid()
) {
  const target = String(goodsId || '').trim()
  if (!target) return { ok: false, error: '缺少商品编码', available: false }

  let offset = 0
  let total = Infinity
  const pageLimit = 100
  const maxOffset = 500

  while (offset < total && offset <= maxOffset) {
    const page = await listStockItems({
      stockId,
      offset,
      limit: pageLimit,
      stockCreatorMchid,
    })
    if (!page.ok) return { ...page, available: false }

    total = page.totalCount
    // total 0: typically whole-store coupon — treat as available for any goods
    if (total === 0) {
      return {
        ok: true,
        available: true,
        unrestricted: true,
        totalCount: 0,
        stockId: page.stockId,
      }
    }
    if (page.data.includes(target)) {
      return {
        ok: true,
        available: true,
        unrestricted: false,
        totalCount: total,
        stockId: page.stockId,
      }
    }
    if (!page.data.length) break
    offset += pageLimit
  }

  return {
    ok: true,
    available: false,
    unrestricted: false,
    totalCount: Number.isFinite(total) ? total : 0,
    stockId: String(stockId || ''),
  }
}

/** Map WeChat stock status to local wx_status. */
function mapWxStockStatusToLocal(wxStatus) {
  const s = String(wxStatus || '').toLowerCase()
  if (s === 'running') return 'running'
  if (s === 'paused') return 'paused'
  if (s === 'unactivated') return 'created'
  if (s === 'audit') return 'audit'
  if (s === 'stoped' || s === 'stopped') return 'stoped'
  return s || 'created'
}

function mapFavorStockToClient(item) {
  if (!item || typeof item !== 'object') return null
  const rule = item.stock_use_rule || {}
  const fixed = rule.fixed_normal_coupon || {}
  return {
    stock_id: item.stock_id != null ? String(item.stock_id) : null,
    stock_creator_mchid: item.stock_creator_mchid || null,
    stock_name: item.stock_name || null,
    status: item.status || null,
    wx_status: mapWxStockStatusToLocal(item.status),
    create_time: item.create_time || null,
    description: item.description || null,
    available_begin_time: item.available_begin_time || null,
    available_end_time: item.available_end_time || null,
    distributed_coupons: item.distributed_coupons != null ? Number(item.distributed_coupons) : null,
    no_cash: item.no_cash,
    stock_type: item.stock_type || null,
    coupon_amount_yuan: fixed.coupon_amount != null ? Number(fixed.coupon_amount) / 100 : null,
    transaction_minimum_yuan: fixed.transaction_minimum != null
      ? Number(fixed.transaction_minimum) / 100
      : null,
    max_coupons: rule.max_coupons != null ? Number(rule.max_coupons) : null,
    max_coupons_per_user: rule.max_coupons_per_user != null ? Number(rule.max_coupons_per_user) : null,
  }
}

/**
 * Query marketing callback URL: GET /v3/marketing/favor/callbacks
 * Query: mchid (required)
 */
async function getFavorCallback(mchid = getStockCreatorMchid()) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const mch = String(mchid || getStockCreatorMchid() || WX_PAY_CONFIG.mchId || '').trim()
  if (!mch) return { ok: false, error: '缺少 mchid' }

  const params = new URLSearchParams({ mchid: mch })
  const urlPath = `/v3/marketing/favor/callbacks?${params}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    const data = result.data || {}
    return {
      ok: true,
      notifyUrl: data.notify_url != null ? String(data.notify_url) : null,
      mchid: data.mchid != null ? String(data.mchid) : mch,
      raw: data,
    }
  }

  // 未设置回调时微信可能返回 404
  if (result.status === 404) {
    return {
      ok: true,
      notifyUrl: null,
      mchid: mch,
      unset: true,
      raw: result.data,
    }
  }

  logger.error('getFavorCallback failed', { mchid: mch, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

function getDefaultFavorNotifyUrl() {
  const fromEnv = String(process.env.WX_FAVOR_NOTIFY_URL || '').trim()
  if (fromEnv) return fromEnv.replace(/\/+$/, '')
  try {
    const { PUBLIC_API_BASE_URL } = require('../config/publicEnv')
    return `${String(PUBLIC_API_BASE_URL || '').replace(/\/+$/, '')}/api/wx/referral/favor/notify`
  } catch {
    return ''
  }
}

/**
 * Set marketing callback URL: POST /v3/marketing/favor/callbacks
 * Body: mchid, notify_url (https, no query), switch?=true
 * Only stock creator mchid can set.
 */
async function setFavorCallback({
  notifyUrl,
  mchid = getStockCreatorMchid(),
  switchOn = true,
} = {}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const mch = String(mchid || getStockCreatorMchid() || WX_PAY_CONFIG.mchId || '').trim()
  const url = String(notifyUrl || getDefaultFavorNotifyUrl() || '').trim()
  if (!mch) return { ok: false, error: '缺少 mchid' }
  if (!url) return { ok: false, error: '缺少 notify_url' }
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, error: 'notify_url 必须为 https 地址' }
  }
  if (url.includes('?')) {
    return { ok: false, error: 'notify_url 不能携带查询参数' }
  }
  // Docs: switch=false is not supported yet
  if (switchOn === false) {
    return { ok: false, error: '暂不支持通过 API 关闭回调，请在商户平台操作' }
  }

  const body = {
    mchid: mch,
    notify_url: url,
    switch: true,
  }
  const result = await signedRequest('POST', '/v3/marketing/favor/callbacks', body)

  if (result.status === 200) {
    return {
      ok: true,
      notifyUrl: result.data?.notify_url != null ? String(result.data.notify_url) : url,
      updateTime: result.data?.update_time || null,
      raw: result.data,
    }
  }

  logger.error('setFavorCallback failed', { status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

module.exports = {
  isFavorEnabled,
  isFavorConfigured,
  getStockCreatorMchid,
  buildOutRequestNo,
  createCouponStock,
  startStock,
  startStockWithRetry,
  pauseStock,
  restartStock,
  listStocks,
  getStock,
  listStockMerchants,
  isMchidAvailableForStock,
  listStockItems,
  isGoodsIdAvailableForStock,
  mapWxStockStatusToLocal,
  mapFavorStockToClient,
  sendCoupon,
  listUserCoupons,
  getCoupon,
  mapFavorCouponToClient,
  getFavorCallback,
  setFavorCallback,
  getDefaultFavorNotifyUrl,
  yuanToCents,
  sanitizeStockName,
  formatRfc3339,
  clampMaxCoupons,
}
