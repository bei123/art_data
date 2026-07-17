/**
 * 微信物流消息（express open_msg）
 * @see https://developers.weixin.qq.com/miniprogram/dev/platform-capabilities/industry/express/business/express_open_msg.html
 */
const axios = require('axios')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { getAccessToken } = require('./wechatMiniProgramToken')
const { OSS_PUBLIC_ORIGIN } = require('../config/publicEnv')

const WECHAT_API_BASE = 'https://api.weixin.qq.com'
const FOLLOW_WAYBILL_PATH = '/cgi-bin/express/delivery/open_msg/follow_waybill'
const QUERY_FOLLOW_TRACE_PATH = '/cgi-bin/express/delivery/open_msg/query_follow_trace'
const UPDATE_FOLLOW_GOODS_PATH = '/cgi-bin/express/delivery/open_msg/update_follow_waybill_goods'
const GET_DELIVERY_LIST_PATH = '/cgi-bin/express/delivery/open_msg/get_delivery_list'

const DELIVERY_LIST_CACHE_KEY = 'wx:express:open_msg:delivery_list'
const DELIVERY_LIST_CACHE_TTL_SEC = parseInt(process.env.WX_EXPRESS_DELIVERY_LIST_TTL_SEC || '3600', 10)

const DEFAULT_ORDER_DETAIL_PATH = '/pages/order/detail'
const DEFAULT_GOODS_IMG = process.env.WX_EXPRESS_DEFAULT_GOODS_IMG
  || `${OSS_PUBLIC_ORIGIN}/static/placeholder-goods.png`

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function getWxCredentials() {
  const appid = process.env.WX_APPID
  const secret = process.env.WX_SECRET
  if (!appid || !secret) {
    return { error: adminResult(500, { error: '服务器配置错误', detail: '缺少 WX_APPID 或 WX_SECRET' }) }
  }
  return { appid, secret }
}

async function resolveAccessToken() {
  const creds = getWxCredentials()
  if (creds.error) return creds
  const access_token = await getAccessToken(creds.appid, creds.secret)
  return { access_token }
}

function clipText(value, maxLen) {
  if (value == null) return ''
  const str = String(value).trim()
  if (!str) return ''
  return [...str].slice(0, maxLen).join('')
}

function resolveGoodsImgUrl(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return DEFAULT_GOODS_IMG
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (trimmed.startsWith('//')) return `https:${trimmed}`
  if (trimmed.startsWith('/')) return `${OSS_PUBLIC_ORIGIN}${trimmed}`
  return `${OSS_PUBLIC_ORIGIN}/${trimmed.replace(/^\/+/, '')}`
}

function getOrderDetailPath(outTradeNo) {
  const base = String(process.env.WX_EXPRESS_ORDER_DETAIL_PATH || DEFAULT_ORDER_DETAIL_PATH).trim()
    || DEFAULT_ORDER_DETAIL_PATH
  const pathOnly = base.split('?')[0]
  const otn = outTradeNo != null ? String(outTradeNo).trim() : ''
  if (!otn) return pathOnly
  const sep = pathOnly.includes('?') ? '&' : '?'
  return `${pathOnly}${sep}out_trade_no=${encodeURIComponent(otn)}`
}

function buildGoodsInfoDetailList(items) {
  const list = Array.isArray(items) ? items : []
  const details = list
    .map((row) => {
      const name = clipText(row.goods_name || row.item_title || row.name || '商品', 60)
      const img = resolveGoodsImgUrl(row.goods_img_url || row.image_url || row.image)
      if (!name) return null
      const detail = {
        goods_name: name,
        goods_img_url: img,
      }
      const desc = clipText(row.goods_desc || row.description || '', 40)
      if (desc) detail.goods_desc = desc
      return detail
    })
    .filter(Boolean)

  if (!details.length) {
    return [{
      goods_name: '商品',
      goods_img_url: DEFAULT_GOODS_IMG,
    }]
  }
  return details
}

async function callOpenMsgApi({ path, body = {}, timeout = 15000, errorLabel = '微信物流消息' }) {
  const tokenResult = await resolveAccessToken()
  if (tokenResult.error) return tokenResult.error

  const url = new URL(`${WECHAT_API_BASE}${path}`)
  url.searchParams.set('access_token', tokenResult.access_token)

  try {
    const { data } = await axios.post(url.toString(), body, { timeout })
    if (data?.errcode != null && data.errcode !== 0) {
      logger.warn(`${errorLabel}接口返回错误`, {
        path,
        errcode: data.errcode,
        errmsg: data.errmsg,
      })
      return adminResult(400, {
        error: data.errmsg || `${errorLabel}失败`,
        errcode: data.errcode,
        errmsg: data.errmsg,
      })
    }
    return adminResult(200, data || {})
  } catch (err) {
    logger.error(`${errorLabel}接口请求失败`, { path, err: err?.message || err })
    return adminResult(500, { error: `${errorLabel}服务暂时不可用`, detail: err.message })
  }
}

/**
 * 获取运力 id 列表（带 Redis 缓存）
 */
async function getDeliveryList({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const cached = await redisClient.get(DELIVERY_LIST_CACHE_KEY)
      if (cached) {
        const parsed = JSON.parse(cached)
        if (parsed && Array.isArray(parsed.delivery_list)) {
          return adminResult(200, {
            ...parsed,
            cached: true,
          })
        }
      }
    } catch (err) {
      logger.warn('open_msg delivery_list cache read failed', { err: err?.message || err })
    }
  }

  const result = await callOpenMsgApi({
    path: GET_DELIVERY_LIST_PATH,
    body: {},
    errorLabel: '获取运力列表',
  })
  if (!result.ok) return result

  const deliveryList = Array.isArray(result.body.delivery_list) ? result.body.delivery_list : []
  const payload = {
    delivery_list: deliveryList.map((row) => ({
      delivery_id: row.delivery_id != null ? String(row.delivery_id) : '',
      delivery_name: row.delivery_name != null ? String(row.delivery_name) : '',
    })).filter((row) => row.delivery_id),
    count: Number(result.body.count) || deliveryList.length,
    provider: 'wx-express-open-msg',
  }

  try {
    await redisClient.setEx(
      DELIVERY_LIST_CACHE_KEY,
      Math.max(60, DELIVERY_LIST_CACHE_TTL_SEC),
      JSON.stringify(payload),
    )
  } catch (err) {
    logger.warn('open_msg delivery_list cache write failed', { err: err?.message || err })
  }

  return adminResult(200, { ...payload, cached: false })
}

/**
 * 传运单：向微信登记运单，返回 waybill_token
 */
async function followWaybill({
  openid,
  receiverPhone,
  waybillId,
  transId,
  outTradeNo,
  goodsItems,
  deliveryId = null,
  senderPhone = null,
  orderDetailPath = null,
}) {
  const cleanOpenid = String(openid || '').trim()
  const cleanWaybill = String(waybillId || '').trim()
  const cleanTransId = String(transId || '').trim()
  const cleanReceiver = String(receiverPhone || '').trim()

  if (!cleanOpenid) return adminResult(400, { error: '缺少用户 openid' })
  if (!cleanWaybill) return adminResult(400, { error: '缺少运单号' })
  if (!cleanTransId) return adminResult(400, { error: '缺少微信支付交易单号 trans_id' })
  if (!cleanReceiver) return adminResult(400, { error: '缺少收件人手机号' })

  const body = {
    openid: cleanOpenid,
    receiver_phone: cleanReceiver,
    waybill_id: cleanWaybill,
    trans_id: cleanTransId,
    goods_info: {
      detail_list: buildGoodsInfoDetailList(goodsItems),
    },
    order_detail_path: orderDetailPath || getOrderDetailPath(outTradeNo),
  }

  if (deliveryId != null && String(deliveryId).trim()) {
    body.delivery_id = String(deliveryId).trim()
  }
  if (senderPhone != null && String(senderPhone).trim()) {
    body.sender_phone = String(senderPhone).trim()
  }

  const result = await callOpenMsgApi({
    path: FOLLOW_WAYBILL_PATH,
    body,
    errorLabel: '传运单 follow_waybill',
  })
  if (!result.ok) return result

  const waybillToken = result.body.waybill_token != null ? String(result.body.waybill_token) : null
  if (!waybillToken) {
    return adminResult(502, { error: '微信未返回 waybill_token', raw: result.body })
  }

  return adminResult(200, {
    waybill_token: waybillToken,
    errcode: result.body.errcode ?? 0,
    errmsg: result.body.errmsg || 'ok',
  })
}

/**
 * 查运单
 */
async function queryFollowTrace({ waybillToken, openid = null }) {
  const token = String(waybillToken || '').trim()
  if (!token) return adminResult(400, { error: '缺少 waybill_token' })

  const body = { waybill_token: token }
  if (openid != null && String(openid).trim()) {
    body.openid = String(openid).trim()
  }

  return callOpenMsgApi({
    path: QUERY_FOLLOW_TRACE_PATH,
    body,
    errorLabel: '查运单 query_follow_trace',
  })
}

/**
 * 更新物品信息
 */
async function updateFollowWaybillGoods({ waybillToken, goodsItems, openid = null }) {
  const token = String(waybillToken || '').trim()
  if (!token) return adminResult(400, { error: '缺少 waybill_token' })

  const body = {
    waybill_token: token,
    goods_info: {
      detail_list: buildGoodsInfoDetailList(goodsItems),
    },
  }
  if (openid != null && String(openid).trim()) {
    body.openid = String(openid).trim()
  }

  return callOpenMsgApi({
    path: UPDATE_FOLLOW_GOODS_PATH,
    body,
    errorLabel: '更新物品信息',
  })
}

module.exports = {
  getDeliveryList,
  followWaybill,
  queryFollowTrace,
  updateFollowWaybillGoods,
  buildGoodsInfoDetailList,
  getOrderDetailPath,
  resolveGoodsImgUrl,
  DEFAULT_GOODS_IMG,
}
