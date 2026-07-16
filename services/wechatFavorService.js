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

function formatRfc3339(date) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n, len = 2) => String(n).padStart(len, '0')
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const h = pad(d.getHours())
  const min = pad(d.getMinutes())
  const s = pad(d.getSeconds())
  const ms = pad(d.getMilliseconds(), 3)
  return `${y}-${m}-${day}T${h}:${min}:${s}.${ms}+08:00`
}

function buildOutRequestNo({ prefix = 'F', userId = 0, stockId = '' } = {}) {
  const mch = getStockCreatorMchid() || '0'
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const nonce = crypto.randomBytes(4).toString('hex')
  const uid = userId ? String(userId) : '0'
  const sid = stockId ? String(stockId).slice(-8) : '0'
  return `${mch}${day}${prefix}${uid}${sid}${nonce}`.slice(0, 64)
}

function sanitizeStockName(title) {
  const raw = String(title || '优惠券').replace(/[_,;|]/g, '').trim()
  const chars = Array.from(raw)
  if (chars.length <= 9) return chars.join('') || '优惠券'
  return chars.slice(0, 9).join('')
}

function wxErrorMessage(data) {
  if (!data || typeof data !== 'object') return '微信支付营销接口失败'
  return data.message || data.detail || data.code || '微信支付营销接口失败'
}

/**
 * Create a no-cash (免充值) NORMAL coupon stock and return stock_id.
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
  const transactionMinimum = Math.max(couponAmount + 1, yuanToCents(minOrderYuan) || couponAmount + 1)
  if (couponAmount < 10 || couponAmount > 100000) {
    return { ok: false, error: '优惠面额需在 0.1～1000 元之间' }
  }
  if (transactionMinimum < couponAmount + 1) {
    return { ok: false, error: '使用门槛须大于优惠面额' }
  }

  const days = Math.min(90, Math.max(1, parseInt(validDays, 10) || 30))
  const begin = new Date()
  begin.setMinutes(begin.getMinutes() + 2)
  const end = new Date(begin)
  end.setDate(end.getDate() + days)

  const mchid = getStockCreatorMchid()
  const maxAmount = couponAmount * maxCoupons
  const outRequestNo = buildOutRequestNo({ prefix: 'C' })

  const body = {
    stock_name: sanitizeStockName(title),
    comment: String(comment || title || '营销活动').slice(0, 60),
    belong_merchant: mchid,
    available_begin_time: formatRfc3339(begin),
    available_end_time: formatRfc3339(end),
    stock_use_rule: {
      max_coupons: maxCoupons,
      max_amount: maxAmount,
      max_coupons_per_user: Math.max(1, maxCouponsPerUser),
      natural_person_limit: false,
      prevent_api_abuse: true,
    },
    coupon_use_rule: {
      fixed_normal_coupon: {
        coupon_amount: couponAmount,
        transaction_minimum: transactionMinimum,
      },
      available_merchants: [mchid],
    },
    no_cash: true,
    stock_type: 'NORMAL',
    out_request_no: outRequestNo,
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

  logger.error('createCouponStock failed', { status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

async function startStock(stockId, stockCreatorMchid = getStockCreatorMchid()) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const id = String(stockId || '').trim()
  if (!id) return { ok: false, error: '缺少 stock_id' }

  const urlPath = `/v3/marketing/favor/stocks/${encodeURIComponent(id)}/start`
  const body = { stock_creator_mchid: String(stockCreatorMchid || getStockCreatorMchid()) }
  const result = await signedRequest('POST', urlPath, body)

  if (result.status === 200 || result.status === 204) {
    return { ok: true, raw: result.data || null }
  }

  logger.error('startStock failed', { stockId: id, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    raw: result.data,
  }
}

async function sendCoupon({
  openid,
  stockId,
  stockCreatorMchid = getStockCreatorMchid(),
  outRequestNo,
  appid = WX_PAY_CONFIG.appId,
}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const oid = String(openid || '').trim()
  const sid = String(stockId || '').trim()
  if (!oid) return { ok: false, error: '缺少 openid' }
  if (!sid) return { ok: false, error: '缺少 stock_id' }

  const reqNo = outRequestNo || buildOutRequestNo({ prefix: 'S', stockId: sid })
  const urlPath = `/v3/marketing/favor/users/${encodeURIComponent(oid)}/coupons`
  const body = {
    stock_id: sid,
    out_request_no: reqNo,
    appid: String(appid),
    stock_creator_mchid: String(stockCreatorMchid || getStockCreatorMchid()),
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

  logger.error('sendCoupon failed', { openid: oid, stockId: sid, status: result.status, data: result.data })
  return {
    ok: false,
    error: wxErrorMessage(result.data),
    code: result.data?.code || null,
    httpStatus: result.status,
    outRequestNo: reqNo,
    raw: result.data,
  }
}

async function listUserCoupons({
  openid,
  appid = WX_PAY_CONFIG.appId,
  stockId,
  status,
  creatorMchid = getStockCreatorMchid(),
  availableMchid = getStockCreatorMchid(),
  offset = 0,
  limit = 20,
}) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const oid = String(openid || '').trim()
  if (!oid) return { ok: false, error: '缺少 openid' }

  const params = new URLSearchParams()
  params.set('appid', String(appid))
  params.set('offset', String(Math.max(0, offset)))
  params.set('limit', String(Math.min(50, Math.max(1, limit))))
  if (creatorMchid) params.set('creator_mchid', String(creatorMchid))
  if (availableMchid) params.set('available_mchid', String(availableMchid))
  if (stockId) params.set('stock_id', String(stockId))
  if (status) params.set('status', String(status))

  const urlPath = `/v3/marketing/favor/users/${encodeURIComponent(oid)}/coupons?${params.toString()}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    const data = result.data || {}
    return {
      ok: true,
      totalCount: Number(data.total_count || 0),
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

async function getCoupon({ openid, couponId, appid = WX_PAY_CONFIG.appId }) {
  if (!isFavorConfigured()) {
    return { ok: false, error: '微信免充值代金券未启用或配置不完整' }
  }
  const oid = String(openid || '').trim()
  const cid = String(couponId || '').trim()
  if (!oid || !cid) return { ok: false, error: '缺少 openid 或 coupon_id' }

  const params = new URLSearchParams({ appid: String(appid) })
  const urlPath = `/v3/marketing/favor/users/${encodeURIComponent(oid)}/coupons/${encodeURIComponent(cid)}?${params}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    return { ok: true, coupon: result.data, raw: result.data }
  }

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
    title: item.description || item.stock_name || '代金券',
    discount_yuan: Math.round(amountCents) / 100,
    min_order_yuan: Math.round(minCents) / 100,
    status: item.status || null,
    available_begin_time: item.available_begin_time || null,
    available_end_time: item.available_end_time || null,
    create_time: item.create_time || null,
  }
}

module.exports = {
  isFavorEnabled,
  isFavorConfigured,
  getStockCreatorMchid,
  buildOutRequestNo,
  createCouponStock,
  startStock,
  sendCoupon,
  listUserCoupons,
  getCoupon,
  mapFavorCouponToClient,
  yuanToCents,
  sanitizeStockName,
}
