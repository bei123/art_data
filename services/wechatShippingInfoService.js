const axios = require('axios')
const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { getAccessToken } = require('./wechatMiniProgramToken')

const WECHAT_API_BASE = 'https://api.weixin.qq.com'
const UPLOAD_SHIPPING_PATH = '/wxa/sec/order/upload_shipping_info'
const UPLOAD_COMBINED_SHIPPING_PATH = '/wxa/sec/order/upload_combined_shipping_info'
const GET_ORDER_PATH = '/wxa/sec/order/get_order'
const GET_ORDER_LIST_PATH = '/wxa/sec/order/get_order_list'
const NOTIFY_CONFIRM_RECEIVE_PATH = '/wxa/sec/order/notify_confirm_receive'
const SET_MSG_JUMP_PATH = '/wxa/sec/order/set_msg_jump_path'
const IS_TRADE_MANAGEMENT_CONFIRMATION_COMPLETED_PATH = '/wxa/sec/order/is_trade_management_confirmation_completed'

const NOTIFY_CONFIRM_RECEIVE_SENT_PREFIX = 'wx:notify_confirm_receive:sent:'
const NOTIFY_CONFIRM_RECEIVE_SENT_TTL_SEC = parseInt(
  process.env.WX_NOTIFY_CONFIRM_RECEIVE_SENT_TTL_SEC || `${60 * 60 * 24 * 365}`,
  10,
)
const SF_SIGN_OFF_ACTION_TYPE = 300003

const LOGISTICS_TYPE_EXPRESS = 1
const DELIVERY_MODE_UNIFIED = 1
const DELIVERY_MODE_SPLIT = 2
const ORDER_NUMBER_TYPE_MCH = 1
const ORDER_NUMBER_TYPE_TRANSACTION = 2

const WECHAT_EXPRESS_COMPANY_BY_DELIVERY_ID = {
  SF: 'SF',
}

const SHIPPING_ERROR_MESSAGES = {
  10060001: '支付单不存在，请检查微信支付单号或商户订单号',
  10060002: '支付单已完成发货，无法继续发货',
  10060003: '支付单已使用重新发货机会，仅可修改一次发货信息',
  10060004: '支付单处于不可发货的状态',
  10060005: '物流类型有误',
  10060006: '非快递发货时不允许分拆发货',
  10060007: '分拆发货模式下必须填写 is_all_delivered',
  10060008: '商品描述不能为空',
  10060009: '商品描述过长',
  10060023: '发货信息未更新（与已录入内容相同）',
  10060031: '支付单不属于该 openid 用户',
  268485226: '物流单号不能为空',
  268485227: '物流公司编码不能为空',
  40013: 'appid 非法',
  40097: '请求参数非法，请检查 appid 是否已填写',
  44990: '达到频控上限，请稍后再试',
  61003: '服务商未被授权，请检查小程序是否已授权 18 或 142 权限集',
  61004: '客户端 IP 未授权，请检查是否在服务商 IP 白名单中',
  61011: '服务商不合法，请检查 access_token',
}

const WECHAT_ORDER_STATE_LABELS = {
  1: '待发货',
  2: '已发货',
  3: '确认收货',
  4: '交易完成',
  5: '已退款',
  6: '资金待结算',
}

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function isWechatShippingUploadEnabled() {
  const raw = process.env.WX_UPLOAD_SHIPPING_INFO_ENABLED
  if (raw == null || String(raw).trim() === '') return true
  return raw === 'true' || raw === '1'
}

function isAutoNotifyConfirmReceiveEnabled() {
  const raw = process.env.WX_AUTO_NOTIFY_CONFIRM_RECEIVE_ENABLED
  if (raw == null || String(raw).trim() === '') return true
  return raw === 'true' || raw === '1'
}

function buildNotifyConfirmReceiveSentKey(orderId) {
  return `${NOTIFY_CONFIRM_RECEIVE_SENT_PREFIX}${orderId}`
}

function clipItemDesc(value, maxLen = 120) {
  if (value == null) return ''
  const str = String(value).trim()
  if (!str) return ''
  return [...str].slice(0, maxLen).join('')
}

function maskWechatContact(phone) {
  const trimmed = String(phone || '').trim()
  if (!trimmed) return ''

  let digits = trimmed.replace(/\D/g, '')
  if (digits.startsWith('86') && digits.length > 11) {
    digits = digits.slice(-11)
  }

  if (digits.length >= 11) {
    return `${digits.slice(0, 3)}****${digits.slice(-4)}`
  }
  if (digits.length >= 7) {
    const visibleHead = Math.min(3, digits.length - 4)
    return `${digits.slice(0, visibleHead)}****${digits.slice(-4)}`
  }
  if (trimmed.length > 4) {
    return `${trimmed.slice(0, Math.max(0, trimmed.length - 4)).replace(/\d/g, '*')}****${trimmed.slice(-4)}`
  }
  return trimmed
}

function formatUploadTimeRfc3339(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) {
    throw new Error('upload_time 无效')
  }

  const cnMs = d.getTime() + 8 * 60 * 60 * 1000
  const cn = new Date(cnMs)
  const y = cn.getUTCFullYear()
  const mo = String(cn.getUTCMonth() + 1).padStart(2, '0')
  const da = String(cn.getUTCDate()).padStart(2, '0')
  const h = String(cn.getUTCHours()).padStart(2, '0')
  const mi = String(cn.getUTCMinutes()).padStart(2, '0')
  const s = String(cn.getUTCSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${y}-${mo}-${da}T${h}:${mi}:${s}.${ms}+08:00`
}

function buildShippingItemDesc(items) {
  const parts = (items || []).map((row) => {
    const name = row.item_title || row.title || '商品'
    const qty = Number(row.quantity) > 0 ? Number(row.quantity) : 1
    return `${name}*${qty}`
  })
  const desc = parts.length ? parts.join('，') : '商品*1'
  return clipItemDesc(desc, 120)
}

function resolveWechatExpressCompany(deliveryId) {
  const key = String(deliveryId || 'SF').trim().toUpperCase()
  return WECHAT_EXPRESS_COMPANY_BY_DELIVERY_ID[key] || key
}

function buildOrderKey({ transactionId, mchid, outTradeNo }) {
  const tx = transactionId != null ? String(transactionId).trim() : ''
  if (tx) {
    return {
      order_number_type: ORDER_NUMBER_TYPE_TRANSACTION,
      transaction_id: tx,
    }
  }

  const mch = mchid != null ? String(mchid).trim() : ''
  const outNo = outTradeNo != null ? String(outTradeNo).trim() : ''
  if (!mch || !outNo) {
    return {
      error: adminResult(400, {
        error: '缺少微信支付单号 transaction_id，或未配置商户号/商户订单号',
      }),
    }
  }

  return {
    order_number_type: ORDER_NUMBER_TYPE_MCH,
    mchid: mch,
    out_trade_no: outNo,
  }
}

function normalizeOrderKeyObject(raw, mchidFallback) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: adminResult(400, { error: 'order_key 无效' }) }
  }

  const orderNumberType = Number(raw.order_number_type)
  if (orderNumberType !== ORDER_NUMBER_TYPE_MCH && orderNumberType !== ORDER_NUMBER_TYPE_TRANSACTION) {
    return { error: adminResult(400, { error: 'order_key.order_number_type 无效' }) }
  }

  if (orderNumberType === ORDER_NUMBER_TYPE_TRANSACTION) {
    const transactionId = raw.transaction_id != null ? String(raw.transaction_id).trim() : ''
    if (!transactionId) {
      return { error: adminResult(400, { error: 'order_key.transaction_id 不能为空' }) }
    }
    return {
      order_number_type: orderNumberType,
      order_key: {
        order_number_type: orderNumberType,
        transaction_id: transactionId,
      },
    }
  }

  const mchid = raw.mchid != null ? String(raw.mchid).trim() : String(mchidFallback || '').trim()
  const outTradeNo = raw.out_trade_no != null ? String(raw.out_trade_no).trim() : ''
  if (!mchid || !outTradeNo) {
    return { error: adminResult(400, { error: 'order_key.mchid 与 out_trade_no 不能为空' }) }
  }

  return {
    order_number_type: orderNumberType,
    order_key: {
      order_number_type: orderNumberType,
      mchid,
      out_trade_no: outTradeNo,
    },
  }
}

function buildShippingListEntry({
  trackingNo,
  expressCompany,
  itemDesc,
  receiverPhone,
  consignorPhone,
}) {
  const tracking_no = String(trackingNo || '').trim()
  const express_company = String(expressCompany || '').trim()
  const item_desc = clipItemDesc(itemDesc, 120)

  if (!tracking_no) {
    return { error: adminResult(400, { error: '缺少物流单号 tracking_no' }) }
  }
  if (!express_company) {
    return { error: adminResult(400, { error: '缺少物流公司编码 express_company' }) }
  }
  if (!item_desc) {
    return { error: adminResult(400, { error: '缺少商品描述 item_desc' }) }
  }

  const entry = {
    tracking_no,
    express_company,
    item_desc,
  }

  const receiver = maskWechatContact(receiverPhone)
  const consignor = maskWechatContact(consignorPhone)
  if (express_company.toUpperCase() === 'SF' && !receiver && !consignor) {
    return {
      error: adminResult(400, {
        error: '顺丰发货时须填写收件人或寄件人联系方式（掩码传输，末四位不可掩码）',
      }),
    }
  }

  const contact = {}
  if (receiver) contact.receiver_contact = receiver
  else if (consignor) contact.consignor_contact = consignor
  if (Object.keys(contact).length) entry.contact = contact

  return { entry }
}

function buildShippingListEntryFromRaw(raw) {
  if (raw?.contact && typeof raw.contact === 'object' && !Array.isArray(raw.contact)) {
    const tracking_no = String(raw.tracking_no || '').trim()
    const express_company = String(raw.express_company || '').trim()
    const item_desc = clipItemDesc(raw.item_desc, 120)

    if (!tracking_no) {
      return { error: adminResult(400, { error: 'shipping_list[].tracking_no 不能为空' }) }
    }
    if (!express_company) {
      return { error: adminResult(400, { error: 'shipping_list[].express_company 不能为空' }) }
    }
    if (!item_desc) {
      return { error: adminResult(400, { error: 'shipping_list[].item_desc 不能为空' }) }
    }

    const entry = { tracking_no, express_company, item_desc }
    const contact = {}
    if (raw.contact.receiver_contact != null && String(raw.contact.receiver_contact).trim()) {
      contact.receiver_contact = String(raw.contact.receiver_contact).trim()
    }
    if (raw.contact.consignor_contact != null && String(raw.contact.consignor_contact).trim()) {
      contact.consignor_contact = String(raw.contact.consignor_contact).trim()
    }
    if (Object.keys(contact).length) entry.contact = contact

    if (express_company.toUpperCase() === 'SF' && !contact.receiver_contact && !contact.consignor_contact) {
      return {
        error: adminResult(400, {
          error: '顺丰发货时 shipping_list[].contact 须包含 receiver_contact 或 consignor_contact',
        }),
      }
    }

    return { entry }
  }

  return buildShippingListEntry({
    trackingNo: raw?.tracking_no,
    expressCompany: raw?.express_company,
    itemDesc: raw?.item_desc,
    receiverPhone: raw?.receiver_phone,
    consignorPhone: raw?.consignor_phone,
  })
}

function buildSubOrderFromRaw(raw, expectedOrderNumberType, mchidFallback) {
  const keyResult = normalizeOrderKeyObject(raw?.order_key, mchidFallback)
  if (keyResult.error) return keyResult

  if (keyResult.order_number_type !== expectedOrderNumberType) {
    return { error: adminResult(400, { error: '子单 order_key.order_number_type 须与合单主单一致' }) }
  }

  const logisticsType = Number(raw?.logistics_type)
  const deliveryMode = Number(raw?.delivery_mode)
  if (!Number.isFinite(logisticsType) || logisticsType < 1 || logisticsType > 4) {
    return { error: adminResult(400, { error: 'sub_orders[].logistics_type 无效' }) }
  }
  if (deliveryMode !== DELIVERY_MODE_UNIFIED && deliveryMode !== DELIVERY_MODE_SPLIT) {
    return { error: adminResult(400, { error: 'sub_orders[].delivery_mode 无效' }) }
  }

  const shippingListRaw = Array.isArray(raw?.shipping_list) ? raw.shipping_list : []
  if (shippingListRaw.length < 1 || shippingListRaw.length > 15) {
    return { error: adminResult(400, { error: 'sub_orders[].shipping_list 长度须在 1-15' }) }
  }
  if (deliveryMode === DELIVERY_MODE_UNIFIED && shippingListRaw.length !== 1) {
    return { error: adminResult(400, { error: '统一发货模式下 shipping_list 长度必须为 1' }) }
  }

  const shipping_list = []
  for (const item of shippingListRaw) {
    const entryResult = buildShippingListEntryFromRaw(item)
    if (entryResult.error) return entryResult
    shipping_list.push(entryResult.entry)
  }

  const subOrder = {
    order_key: keyResult.order_key,
    logistics_type: logisticsType,
    delivery_mode: deliveryMode,
    shipping_list,
  }

  if (deliveryMode === DELIVERY_MODE_SPLIT) {
    if (raw?.is_all_delivered === undefined || raw?.is_all_delivered === null) {
      return { error: adminResult(400, { error: '分拆发货模式下须填写 is_all_delivered' }) }
    }
    subOrder.is_all_delivered = Boolean(raw.is_all_delivered)
  }

  return { sub_order: subOrder }
}

function buildUploadCombinedShippingPayload({
  orderKey,
  openid,
  subOrders,
  uploadTime,
  mchidFallback,
}) {
  if (!openid || !String(openid).trim()) {
    return { error: adminResult(400, { error: '缺少 payer.openid' }) }
  }

  const mainKeyResult = normalizeOrderKeyObject(orderKey, mchidFallback)
  if (mainKeyResult.error) return mainKeyResult

  const subOrdersRaw = Array.isArray(subOrders) ? subOrders : []
  if (!subOrdersRaw.length) {
    return { error: adminResult(400, { error: '缺少 sub_orders 子单物流详情' }) }
  }

  const sub_orders = []
  for (const raw of subOrdersRaw) {
    const subResult = buildSubOrderFromRaw(raw, mainKeyResult.order_number_type, mchidFallback)
    if (subResult.error) return subResult
    sub_orders.push(subResult.sub_order)
  }

  return {
    payload: {
      order_key: mainKeyResult.order_key,
      sub_orders,
      upload_time: uploadTime || formatUploadTimeRfc3339(),
      payer: { openid: String(openid).trim() },
    },
  }
}

function buildUploadShippingPayload({
  orderKey,
  openid,
  trackingNo,
  expressCompany,
  itemDesc,
  receiverPhone,
  consignorPhone,
  logisticsType = LOGISTICS_TYPE_EXPRESS,
  deliveryMode = DELIVERY_MODE_UNIFIED,
  uploadTime,
}) {
  if (!openid || !String(openid).trim()) {
    return { error: adminResult(400, { error: '缺少 payer.openid' }) }
  }

  const listResult = buildShippingListEntry({
    trackingNo,
    expressCompany,
    itemDesc,
    receiverPhone,
    consignorPhone,
  })
  if (listResult.error) return listResult

  if (deliveryMode !== DELIVERY_MODE_UNIFIED) {
    return { error: adminResult(400, { error: '当前仅支持统一发货（delivery_mode=1）' }) }
  }

  return {
    payload: {
      order_key: orderKey,
      logistics_type: logisticsType,
      delivery_mode: deliveryMode,
      shipping_list: [listResult.entry],
      upload_time: uploadTime || formatUploadTimeRfc3339(),
      payer: { openid: String(openid).trim() },
    },
  }
}

function mapWechatShippingError(data, fallbackMessage = '微信发货信息录入失败') {
  const hint = SHIPPING_ERROR_MESSAGES[data.errcode]
  return adminResult(502, {
    error: hint || data.errmsg || fallbackMessage,
    errcode: data.errcode,
    errmsg: data.errmsg,
  })
}

function buildGetOrderPayload({
  transactionId,
  merchantId,
  merchantTradeNo,
  subMerchantId,
}) {
  const transaction_id = transactionId != null ? String(transactionId).trim() : ''
  const merchant_id = merchantId != null ? String(merchantId).trim() : ''
  const merchant_trade_no = merchantTradeNo != null ? String(merchantTradeNo).trim() : ''
  const sub_merchant_id = subMerchantId != null ? String(subMerchantId).trim() : ''

  if (transaction_id) {
    const payload = { transaction_id }
    if (merchant_id) payload.merchant_id = merchant_id
    if (merchant_trade_no) payload.merchant_trade_no = merchant_trade_no
    if (sub_merchant_id) payload.sub_merchant_id = sub_merchant_id
    return { payload }
  }

  if (merchant_id && merchant_trade_no) {
    const payload = { merchant_id, merchant_trade_no }
    if (sub_merchant_id) payload.sub_merchant_id = sub_merchant_id
    return { payload }
  }

  return {
    error: adminResult(400, {
      error: '须传 transaction_id，或 merchant_id + merchant_trade_no',
    }),
  }
}

function parseReceivedTimeUnix(value) {
  if (value == null || value === '') {
    return { error: adminResult(400, { error: '缺少 received_time（快递签收时间，Unix 秒）' }) }
  }

  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) {
    return { received_time: Math.floor(numeric) }
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return { error: adminResult(400, { error: 'received_time 无效，请传 Unix 秒时间戳' }) }
  }

  return { received_time: Math.floor(parsed.getTime() / 1000) }
}

function buildNotifyConfirmReceivePayload({
  transactionId,
  merchantId,
  merchantTradeNo,
  subMerchantId,
  receivedTime,
}) {
  const orderResult = buildGetOrderPayload({
    transactionId,
    merchantId,
    merchantTradeNo,
    subMerchantId,
  })
  if (orderResult.error) return orderResult

  const receivedResult = parseReceivedTimeUnix(receivedTime)
  if (receivedResult.error) return receivedResult

  return {
    payload: {
      ...orderResult.payload,
      received_time: receivedResult.received_time,
    },
  }
}

function normalizeMiniProgramPath(path) {
  const trimmed = String(path ?? '').trim()
  if (!trimmed) return ''
  return trimmed.replace(/^\/+/, '')
}

function resolveMsgJumpPathFromEnv() {
  const raw = process.env.WX_MSG_JUMP_PATH ?? process.env.WX_SUBSCRIBE_ORDER_PAGE
  return raw != null ? String(raw).trim() : ''
}

function buildSetMsgJumpPathPayload({ path }) {
  const normalized = normalizeMiniProgramPath(path)
  if (!normalized) {
    return { error: adminResult(400, { error: '缺少 path（小程序页面路径）' }) }
  }
  if (normalized.length > 512) {
    return { error: adminResult(400, { error: 'path 过长（最多 512 字符）' }) }
  }
  return { payload: { path: normalized } }
}

function resolveAppidFromInput(appid) {
  const value = appid != null && String(appid).trim() !== ''
    ? String(appid).trim()
    : String(process.env.WX_APPID || '').trim()
  if (!value) {
    return { error: adminResult(400, { error: '缺少 appid（请求体传入或配置 WX_APPID）' }) }
  }
  return { appid: value }
}

function buildIsTradeManagementConfirmationCompletedPayload({ appid }) {
  const resolved = resolveAppidFromInput(appid)
  if (resolved.error) return resolved
  return { payload: { appid: resolved.appid } }
}

function enrichWechatOrderItem(order) {
  if (!order || order.order_state == null) return order
  const state = Number(order.order_state)
  return {
    ...order,
    order_state_label: WECHAT_ORDER_STATE_LABELS[state] || null,
  }
}

function enrichWechatOrderResponse(data) {
  if (!data?.order) return data
  return {
    ...data,
    order: enrichWechatOrderItem(data.order),
  }
}

function enrichWechatOrderListResponse(data) {
  if (!Array.isArray(data?.order_list)) return data
  return {
    ...data,
    order_list: data.order_list.map(enrichWechatOrderItem),
  }
}

function buildPayTimeRange(raw) {
  if (raw == null || raw === '') return { pay_time_range: null }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: adminResult(400, { error: 'pay_time_range 无效' }) }
  }

  const pay_time_range = {}
  if (raw.begin_time != null && raw.begin_time !== '') {
    const beginTime = Number(raw.begin_time)
    if (!Number.isFinite(beginTime) || beginTime < 0) {
      return { error: adminResult(400, { error: 'pay_time_range.begin_time 无效' }) }
    }
    pay_time_range.begin_time = Math.floor(beginTime)
  }
  if (raw.end_time != null && raw.end_time !== '') {
    const endTime = Number(raw.end_time)
    if (!Number.isFinite(endTime) || endTime < 0) {
      return { error: adminResult(400, { error: 'pay_time_range.end_time 无效' }) }
    }
    pay_time_range.end_time = Math.floor(endTime)
  }

  if (
    pay_time_range.begin_time != null
    && pay_time_range.end_time != null
    && pay_time_range.begin_time > pay_time_range.end_time
  ) {
    return { error: adminResult(400, { error: 'pay_time_range.begin_time 不能晚于 end_time' }) }
  }

  return { pay_time_range: Object.keys(pay_time_range).length ? pay_time_range : null }
}

function buildGetOrderListPayload({
  payTimeRange,
  orderState,
  openid,
  lastIndex,
  pageSize,
}) {
  const payload = {}

  const rangeResult = buildPayTimeRange(payTimeRange)
  if (rangeResult.error) return rangeResult
  if (rangeResult.pay_time_range) payload.pay_time_range = rangeResult.pay_time_range

  if (orderState != null && orderState !== '') {
    const state = Number(orderState)
    if (!Number.isFinite(state) || !WECHAT_ORDER_STATE_LABELS[state]) {
      return { error: adminResult(400, { error: 'order_state 无效，取值 1-6' }) }
    }
    payload.order_state = state
  }

  const openidValue = openid != null ? String(openid).trim() : ''
  if (openidValue) payload.openid = openidValue

  const lastIndexValue = lastIndex != null ? String(lastIndex).trim() : ''
  if (lastIndexValue) payload.last_index = lastIndexValue

  if (pageSize != null && pageSize !== '') {
    const size = Number(pageSize)
    if (!Number.isFinite(size) || size < 1 || size > 100) {
      return { error: adminResult(400, { error: 'page_size 无效，取值 1-100' }) }
    }
    payload.page_size = Math.floor(size)
  }

  return { payload }
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

async function callWechatOrderSecApi({
  path,
  body,
  timeout = 15000,
  errorLabel = '微信发货信息录入',
}) {
  const tokenResult = await resolveAccessToken()
  if (tokenResult.error) return tokenResult.error

  const url = new URL(`${WECHAT_API_BASE}${path}`)
  url.searchParams.set('access_token', tokenResult.access_token)

  try {
    const { data } = await axios.post(url.toString(), body, { timeout })
    if (data.errcode != null && data.errcode !== 0) {
      logger.warn(`${errorLabel}接口返回错误`, {
        path,
        errcode: data.errcode,
        errmsg: data.errmsg,
        transaction_id: body.transaction_id,
        merchant_trade_no: body.merchant_trade_no,
      })
      return mapWechatShippingError(data, `${errorLabel}失败`)
    }
    return adminResult(200, data)
  } catch (err) {
    logger.error(`${errorLabel}接口请求失败`, { path, err })
    return adminResult(500, { error: `${errorLabel}服务暂时不可用`, detail: err.message })
  }
}

async function callWechatShippingApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: UPLOAD_SHIPPING_PATH,
    body,
    timeout,
    errorLabel: '微信发货信息录入',
  })
}

async function callWechatCombinedShippingApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: UPLOAD_COMBINED_SHIPPING_PATH,
    body,
    timeout,
    errorLabel: '微信合单发货信息录入',
  })
}

async function callWechatGetOrderApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: GET_ORDER_PATH,
    body,
    timeout,
    errorLabel: '微信订单发货状态查询',
  })
}

async function callWechatGetOrderListApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: GET_ORDER_LIST_PATH,
    body,
    timeout,
    errorLabel: '微信订单列表查询',
  })
}

async function callWechatNotifyConfirmReceiveApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: NOTIFY_CONFIRM_RECEIVE_PATH,
    body,
    timeout,
    errorLabel: '微信确认收货提醒',
  })
}

async function callWechatSetMsgJumpPathApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: SET_MSG_JUMP_PATH,
    body,
    timeout,
    errorLabel: '微信消息跳转路径设置',
  })
}

async function callWechatIsTradeManagementConfirmationCompletedApi(body, timeout = 15000) {
  return callWechatOrderSecApi({
    path: IS_TRADE_MANAGEMENT_CONFIRMATION_COMPLETED_PATH,
    body,
    timeout,
    errorLabel: '微信交易结算管理确认查询',
  })
}

async function resolveOpenidFromInput({ openid, touser, userId, wxUserId }) {
  const direct = openid ?? touser
  if (direct != null && String(direct).trim()) {
    return { openid: String(direct).trim() }
  }

  const id = parseInt(String(userId ?? wxUserId ?? ''), 10)
  if (Number.isNaN(id) || id <= 0) {
    return { error: adminResult(400, { error: '缺少 openid 或有效的 userId / wxUserId' }) }
  }

  const [rows] = await db.query('SELECT openid FROM wx_users WHERE id = ? LIMIT 1', [id])
  if (!rows?.length || !rows[0].openid) {
    return { error: adminResult(404, { error: '用户不存在或未绑定 openid' }) }
  }
  return { openid: String(rows[0].openid).trim() }
}

async function loadOrderShippingUploadContext(internalOrderId) {
  const id = parseInt(String(internalOrderId ?? ''), 10)
  if (!id || Number.isNaN(id) || id <= 0) {
    return { error: adminResult(400, { error: '缺少有效的 internal_order_id' }) }
  }

  const [orderRows] = await db.query(
    `SELECT o.id, o.out_trade_no, o.transaction_id, o.user_id, o.trade_state, wu.openid
     FROM orders o
     JOIN wx_users wu ON wu.id = o.user_id
     WHERE o.id = ?
     LIMIT 1`,
    [id],
  )
  if (!orderRows?.length) {
    return { error: adminResult(404, { error: '订单不存在' }) }
  }

  const orderRow = orderRows[0]
  if (orderRow.trade_state !== 'SUCCESS') {
    return { error: adminResult(400, { error: '仅支付成功的订单可录入发货信息', trade_state: orderRow.trade_state }) }
  }
  if (!orderRow.openid) {
    return { error: adminResult(400, { error: '订单买家未绑定 openid，无法录入微信发货信息' }) }
  }

  const [physicalItems] = await db.query(
    `SELECT oi.quantity,
            COALESCE(r.title, oa.title) AS item_title
     FROM order_items oi
     LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
     LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
     WHERE oi.order_id = ? AND oi.type IN ('right', 'artwork')
     ORDER BY oi.id ASC`,
    [id],
  )

  const [addrRows] = await db.query(
    `SELECT wa.receiver_phone
     FROM order_items oi
     JOIN wx_user_addresses wa ON oi.address_id = wa.id
     WHERE oi.order_id = ? AND oi.address_id IS NOT NULL
     LIMIT 1`,
    [id],
  )

  return {
    orderRow,
    physicalItems: physicalItems || [],
    receiverPhone: addrRows?.[0]?.receiver_phone || null,
  }
}

async function uploadShippingInfoDirect(options) {
  if (!isWechatShippingUploadEnabled()) {
    return adminResult(503, { error: '微信发货信息录入未启用（WX_UPLOAD_SHIPPING_INFO_ENABLED）' })
  }

  const mchid = options.mchid ?? process.env.WX_PAY_MCH_ID
  const orderKeyResult = buildOrderKey({
    transactionId: options.transactionId,
    mchid,
    outTradeNo: options.outTradeNo,
  })
  if (orderKeyResult.error) return orderKeyResult.error

  const built = buildUploadShippingPayload({
    orderKey: orderKeyResult,
    openid: options.openid,
    trackingNo: options.trackingNo,
    expressCompany: options.expressCompany || resolveWechatExpressCompany(options.deliveryId),
    itemDesc: options.itemDesc || buildShippingItemDesc(options.physicalItems),
    receiverPhone: options.receiverPhone,
    consignorPhone: options.consignorPhone,
    logisticsType: options.logisticsType,
    deliveryMode: options.deliveryMode,
    uploadTime: options.uploadTime,
  })
  if (built.error) return built.error

  return callWechatShippingApi(built.payload, options.timeout)
}

async function uploadShippingInfoForOrder({
  internalOrderId,
  waybillId,
  deliveryId = 'SF',
  itemDesc,
  receiverPhone,
  consignorPhone,
  uploadTime,
}) {
  const ctx = await loadOrderShippingUploadContext(internalOrderId)
  if (ctx.error) return ctx.error

  const trackingNo = waybillId != null ? String(waybillId).trim() : ''
  if (!trackingNo) {
    return adminResult(400, { error: '缺少运单号 waybill_id' })
  }

  return uploadShippingInfoDirect({
    transactionId: ctx.orderRow.transaction_id,
    outTradeNo: ctx.orderRow.out_trade_no,
    openid: ctx.orderRow.openid,
    trackingNo,
    deliveryId,
    expressCompany: resolveWechatExpressCompany(deliveryId),
    itemDesc: itemDesc || buildShippingItemDesc(ctx.physicalItems),
    receiverPhone: receiverPhone ?? ctx.receiverPhone,
    consignorPhone,
    physicalItems: ctx.physicalItems,
    uploadTime,
  })
}

async function getWechatOrderDirect(options) {
  const built = buildGetOrderPayload({
    transactionId: options.transactionId,
    merchantId: options.merchantId ?? process.env.WX_PAY_MCH_ID,
    merchantTradeNo: options.merchantTradeNo,
    subMerchantId: options.subMerchantId,
  })
  if (built.error) return built.error

  const result = await callWechatGetOrderApi(built.payload, options.timeout)
  if (!result.ok) return result
  return adminResult(200, enrichWechatOrderResponse(result.body))
}

async function getWechatOrderForInternalOrder(internalOrderId) {
  const id = parseInt(String(internalOrderId ?? ''), 10)
  if (!id || Number.isNaN(id) || id <= 0) {
    return { error: adminResult(400, { error: '缺少有效的 internal_order_id' }) }
  }

  const [orderRows] = await db.query(
    `SELECT id, out_trade_no, transaction_id
     FROM orders
     WHERE id = ?
     LIMIT 1`,
    [id],
  )
  if (!orderRows?.length) {
    return { error: adminResult(404, { error: '订单不存在' }) }
  }

  const orderRow = orderRows[0]
  return getWechatOrderDirect({
    transactionId: orderRow.transaction_id,
    merchantTradeNo: orderRow.out_trade_no,
  })
}

function buildWechatOrderConfirmExtraData({ transactionId, merchantId, outTradeNo }) {
  const extra = {}
  const tx = transactionId != null ? String(transactionId).trim() : ''
  const mch = merchantId != null ? String(merchantId).trim() : ''
  const outNo = outTradeNo != null ? String(outTradeNo).trim() : ''

  if (tx) extra.transaction_id = tx
  if (mch) extra.merchant_id = mch
  if (outNo) extra.merchant_trade_no = outNo

  return extra
}

function hasWechatOrderConfirmExtraData(extraData) {
  if (!extraData || typeof extraData !== 'object') return false
  if (extraData.transaction_id) return true
  return Boolean(extraData.merchant_id && extraData.merchant_trade_no)
}

function isWechatOrderConfirmReceiptCompleted(orderState) {
  const state = Number(orderState)
  return state === 3 || state === 4
}

function canOpenWechatOrderConfirmByWxState(orderState) {
  return Number(orderState) === 2
}

async function verifyWechatConfirmReceiptDirect({ transactionId, merchantTradeNo, buyerOpenid }) {
  const result = await getWechatOrderDirect({
    transactionId,
    merchantTradeNo,
  })
  if (!result.ok) return result

  const wxOrder = result.body?.order
  if (!wxOrder) {
    return adminResult(502, { error: '微信未返回订单信息' })
  }

  const wxOpenid = wxOrder.openid != null ? String(wxOrder.openid).trim() : ''
  const expectedOpenid = buyerOpenid != null ? String(buyerOpenid).trim() : ''
  if (expectedOpenid && wxOpenid && wxOpenid !== expectedOpenid) {
    return adminResult(403, {
      error: '支付单不属于当前用户',
      errcode: 10060031,
    })
  }

  const orderState = Number(wxOrder.order_state)
  return adminResult(200, {
    success: true,
    verified: true,
    confirm_receipt_completed: isWechatOrderConfirmReceiptCompleted(orderState),
    can_open_confirm_component: canOpenWechatOrderConfirmByWxState(orderState),
    order_state: orderState,
    order_state_label: wxOrder.order_state_label || WECHAT_ORDER_STATE_LABELS[orderState] || null,
    wx_order: wxOrder,
  })
}

async function getWechatOrder(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}

  const internalOrderId = parseInt(String(b.internal_order_id ?? b.order_id ?? ''), 10)
  if (!Number.isNaN(internalOrderId) && internalOrderId > 0) {
    return getWechatOrderForInternalOrder(internalOrderId)
  }

  return getWechatOrderDirect({
    transactionId: b.transaction_id,
    merchantId: b.merchant_id ?? b.mchid,
    merchantTradeNo: b.merchant_trade_no ?? b.out_trade_no,
    subMerchantId: b.sub_merchant_id,
  })
}

async function getWechatOrderListDirect(options) {
  const built = buildGetOrderListPayload({
    payTimeRange: options.payTimeRange,
    orderState: options.orderState,
    openid: options.openid,
    lastIndex: options.lastIndex,
    pageSize: options.pageSize,
  })
  if (built.error) return built.error

  const result = await callWechatGetOrderListApi(built.payload, options.timeout)
  if (!result.ok) return result
  return adminResult(200, enrichWechatOrderListResponse(result.body))
}

async function getWechatOrderList(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}

  let openid = b.openid ?? b.touser
  if (openid == null || !String(openid).trim()) {
    const openidResult = await resolveOpenidFromInput({
      userId: b.userId ?? b.user_id,
      wxUserId: b.wxUserId ?? b.wx_user_id,
    })
    if (openidResult.error && (b.userId != null || b.user_id != null || b.wxUserId != null || b.wx_user_id != null)) {
      return openidResult.error
    }
    if (openidResult.openid) openid = openidResult.openid
  }

  return getWechatOrderListDirect({
    payTimeRange: b.pay_time_range,
    orderState: b.order_state,
    openid,
    lastIndex: b.last_index,
    pageSize: b.page_size,
  })
}

async function notifyConfirmReceiveDirect(options) {
  const built = buildNotifyConfirmReceivePayload({
    transactionId: options.transactionId,
    merchantId: options.merchantId ?? process.env.WX_PAY_MCH_ID,
    merchantTradeNo: options.merchantTradeNo,
    subMerchantId: options.subMerchantId,
    receivedTime: options.receivedTime,
  })
  if (built.error) return built.error

  return callWechatNotifyConfirmReceiveApi(built.payload, options.timeout)
}

async function notifyConfirmReceiveForInternalOrder(internalOrderId, receivedTime) {
  const id = parseInt(String(internalOrderId ?? ''), 10)
  if (!id || Number.isNaN(id) || id <= 0) {
    return { error: adminResult(400, { error: '缺少有效的 internal_order_id' }) }
  }

  const [orderRows] = await db.query(
    `SELECT id, out_trade_no, transaction_id
     FROM orders
     WHERE id = ?
     LIMIT 1`,
    [id],
  )
  if (!orderRows?.length) {
    return { error: adminResult(404, { error: '订单不存在' }) }
  }

  const orderRow = orderRows[0]
  return notifyConfirmReceiveDirect({
    transactionId: orderRow.transaction_id,
    merchantTradeNo: orderRow.out_trade_no,
    receivedTime,
  })
}

async function notifyConfirmReceive(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const receivedTime = b.received_time ?? b.receivedTime

  const internalOrderId = parseInt(String(b.internal_order_id ?? b.order_id ?? ''), 10)
  if (!Number.isNaN(internalOrderId) && internalOrderId > 0) {
    const result = await notifyConfirmReceiveForInternalOrder(internalOrderId, receivedTime)
    if (result.ok) await markNotifyConfirmReceiveSent(internalOrderId)
    return result
  }

  return notifyConfirmReceiveDirect({
    transactionId: b.transaction_id,
    merchantId: b.merchant_id ?? b.mchid,
    merchantTradeNo: b.merchant_trade_no ?? b.out_trade_no,
    subMerchantId: b.sub_merchant_id,
    receivedTime,
  })
}

async function hasNotifyConfirmReceiveSent(orderId) {
  const id = parseInt(String(orderId ?? ''), 10)
  if (!id || Number.isNaN(id) || id <= 0) return false
  try {
    return Boolean(await redisClient.get(buildNotifyConfirmReceiveSentKey(id)))
  } catch (err) {
    logger.warn('读取确认收货提醒 Redis 标记失败', { orderId: id, err: err?.message || err })
    return false
  }
}

async function markNotifyConfirmReceiveSent(orderId) {
  const id = parseInt(String(orderId ?? ''), 10)
  if (!id || Number.isNaN(id) || id <= 0) return
  try {
    const ttl = Number.isFinite(NOTIFY_CONFIRM_RECEIVE_SENT_TTL_SEC) && NOTIFY_CONFIRM_RECEIVE_SENT_TTL_SEC > 0
      ? NOTIFY_CONFIRM_RECEIVE_SENT_TTL_SEC
      : 60 * 60 * 24 * 365
    await redisClient.setEx(buildNotifyConfirmReceiveSentKey(id), ttl, '1')
  } catch (err) {
    logger.warn('写入确认收货提醒 Redis 标记失败', { orderId: id, err: err?.message || err })
  }
}

async function maybeNotifyConfirmReceiveOnSignOff({
  orderId,
  actionType,
  actionTime,
  force = false,
}) {
  if (!isAutoNotifyConfirmReceiveEnabled()) {
    return { skipped: true, reason: 'auto_notify_disabled' }
  }
  if (Number(actionType) !== SF_SIGN_OFF_ACTION_TYPE) {
    return { skipped: true, reason: 'not_signed' }
  }

  const id = parseInt(String(orderId ?? ''), 10)
  if (!id || Number.isNaN(id) || id <= 0) {
    return { skipped: true, reason: 'missing_order_id' }
  }

  if (!force && await hasNotifyConfirmReceiveSent(id)) {
    return { skipped: true, reason: 'already_sent' }
  }

  const actionAtSec = Number(actionTime) || 0
  const receivedTime = actionAtSec > 0 ? Math.floor(actionAtSec) : Math.floor(Date.now() / 1000)
  const result = await notifyConfirmReceiveForInternalOrder(id, receivedTime)
  if (result.ok) await markNotifyConfirmReceiveSent(id)
  return result
}

function fireWechatConfirmReceiveNotify(taskPromise, meta = {}) {
  Promise.resolve(taskPromise).catch((err) => {
    logger.warn('微信确认收货提醒异步任务异常', { ...meta, err: err?.message || err })
  })
}

async function setMsgJumpPathDirect(options) {
  const built = buildSetMsgJumpPathPayload({ path: options.path })
  if (built.error) return built.error

  return callWechatSetMsgJumpPathApi(built.payload, options.timeout)
}

async function setMsgJumpPath(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const path = b.path ?? resolveMsgJumpPathFromEnv()
  return setMsgJumpPathDirect({ path })
}

async function isTradeManagementConfirmationCompletedDirect(options) {
  const built = buildIsTradeManagementConfirmationCompletedPayload({ appid: options.appid })
  if (built.error) return built.error

  return callWechatIsTradeManagementConfirmationCompletedApi(built.payload, options.timeout)
}

async function isTradeManagementConfirmationCompleted(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  return isTradeManagementConfirmationCompletedDirect({ appid: b.appid })
}

async function uploadCombinedShippingInfoDirect(options) {
  if (!isWechatShippingUploadEnabled()) {
    return adminResult(503, { error: '微信发货信息录入未启用（WX_UPLOAD_SHIPPING_INFO_ENABLED）' })
  }

  const mchidFallback = options.mchid ?? process.env.WX_PAY_MCH_ID
  const built = buildUploadCombinedShippingPayload({
    orderKey: options.orderKey,
    openid: options.openid,
    subOrders: options.subOrders,
    uploadTime: options.uploadTime,
    mchidFallback,
  })
  if (built.error) return built.error

  return callWechatCombinedShippingApi(built.payload, options.timeout)
}

async function uploadCombinedShippingInfo(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}

  if (!b.order_key || !Array.isArray(b.sub_orders) || !b.sub_orders.length) {
    return adminResult(400, {
      error: '缺少 order_key 或 sub_orders',
      hint: '合单发货须传合单 order_key、sub_orders 数组及 payer.openid',
    })
  }

  const openidResult = await resolveOpenidFromInput({
    openid: b.payer?.openid ?? b.openid,
    touser: b.touser,
    userId: b.userId ?? b.user_id,
    wxUserId: b.wxUserId ?? b.wx_user_id,
  })
  if (openidResult.error) return openidResult.error

  return uploadCombinedShippingInfoDirect({
    orderKey: b.order_key,
    subOrders: b.sub_orders,
    openid: openidResult.openid,
    uploadTime: b.upload_time,
    mchid: b.mchid,
  })
}

async function uploadShippingInfo(req) {
  const b = req.body && typeof req.body === 'object' ? req.body : {}
  const internalOrderId = parseInt(String(b.internal_order_id ?? b.order_id ?? ''), 10)
  if (!internalOrderId || Number.isNaN(internalOrderId) || internalOrderId <= 0) {
    return adminResult(400, { error: '缺少有效的 internal_order_id' })
  }

  let waybillId = b.waybill_id != null ? String(b.waybill_id).trim() : ''
  const deliveryId = b.delivery_id != null ? String(b.delivery_id).trim() : 'SF'

  if (!waybillId) {
    const [rows] = await db.query(
      `SELECT waybill_id, delivery_id
       FROM order_shipments
       WHERE order_id = ? AND status = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [internalOrderId],
    )
    if (rows?.length) {
      waybillId = String(rows[0].waybill_id || '').trim()
      if (!b.delivery_id && rows[0].delivery_id) {
        return uploadShippingInfoForOrder({
          internalOrderId,
          waybillId,
          deliveryId: String(rows[0].delivery_id).trim(),
          itemDesc: b.item_desc,
          receiverPhone: b.receiver_phone,
          consignorPhone: b.consignor_phone,
          uploadTime: b.upload_time,
        })
      }
    }
  }

  return uploadShippingInfoForOrder({
    internalOrderId,
    waybillId,
    deliveryId,
    itemDesc: b.item_desc,
    receiverPhone: b.receiver_phone,
    consignorPhone: b.consignor_phone,
    uploadTime: b.upload_time,
  })
}

function fireWechatShippingUpload(taskPromise, meta = {}) {
  Promise.resolve(taskPromise).catch((err) => {
    logger.warn('微信发货信息录入异步任务异常', { ...meta, err: err?.message || err })
  })
}

module.exports = {
  isWechatShippingUploadEnabled,
  maskWechatContact,
  formatUploadTimeRfc3339,
  buildShippingItemDesc,
  buildUploadShippingPayload,
  buildUploadCombinedShippingPayload,
  buildSubOrderFromRaw,
  buildGetOrderPayload,
  buildGetOrderListPayload,
  buildNotifyConfirmReceivePayload,
  buildSetMsgJumpPathPayload,
  buildIsTradeManagementConfirmationCompletedPayload,
  buildWechatOrderConfirmExtraData,
  hasWechatOrderConfirmExtraData,
  isWechatOrderConfirmReceiptCompleted,
  canOpenWechatOrderConfirmByWxState,
  verifyWechatConfirmReceiptDirect,
  WECHAT_ORDER_STATE_LABELS,
  uploadShippingInfoDirect,
  uploadCombinedShippingInfoDirect,
  getWechatOrderDirect,
  getWechatOrderForInternalOrder,
  getWechatOrder,
  getWechatOrderListDirect,
  getWechatOrderList,
  notifyConfirmReceiveDirect,
  notifyConfirmReceiveForInternalOrder,
  notifyConfirmReceive,
  isAutoNotifyConfirmReceiveEnabled,
  maybeNotifyConfirmReceiveOnSignOff,
  fireWechatConfirmReceiveNotify,
  setMsgJumpPathDirect,
  setMsgJumpPath,
  isTradeManagementConfirmationCompletedDirect,
  isTradeManagementConfirmationCompleted,
  uploadShippingInfoForOrder,
  uploadShippingInfo,
  uploadCombinedShippingInfo,
  fireWechatShippingUpload,
}
