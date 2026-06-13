const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { PUBLIC_API_BASE_URL, OSS_PUBLIC_ORIGIN } = require('../config/publicEnv')
const { DIGITAL_ITEM_JOIN_SQL } = require('../utils/digitalArtworkResolver')
const {
  getWxSubscribeTemplates,
  isWxSubscribeNotifyEnabled,
  isPaymentPendingNotifyEnabled,
  isVirtualDeliveryNotifyEnabled,
  getVirtualDeliveryNotifyType,
  getVirtualDeliveryDefaultProductImg,
  buildSubscribeOrderPage,
} = require('../config/wxSubscribeTemplates')
const { sendSubscribeMessageDirect, setUserNotifyDirect } = require('./subscribeMessageService')

const SUBSCRIBE_SENT_TTL_SEC = 60 * 60 * 24 * 7
const PAYMENT_DEADLINE_MINUTES = parseInt(process.env.WX_SUBSCRIBE_PAYMENT_DEADLINE_MINUTES || '30', 10)
const VIRTUAL_DELIVERY_NOTIFY_RETRY_MS = parseInt(process.env.WX_VIRTUAL_DELIVERY_NOTIFY_RETRY_MS || '65000', 10)

function clipText(value, maxLen) {
  if (value == null) return ''
  const str = String(value).trim()
  if (!str) return ''
  return [...str].slice(0, maxLen).join('')
}

function formatAmountYuan(yuan) {
  const n = Number(yuan)
  if (!Number.isFinite(n)) return '0元'
  const fixed = n.toFixed(2).replace(/\.?0+$/, '')
  return clipText(`${fixed}元`, 12)
}

function formatWechatDateTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(d.getTime())) return clipText(formatWechatDateTime(new Date()), 32)
  const pad = (n) => String(n).padStart(2, '0')
  return clipText(
    `${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    32,
  )
}

function formatWechatDate(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(d.getTime())) return clipText(formatWechatDate(new Date()), 32)
  const pad = (n) => String(n).padStart(2, '0')
  return clipText(`${d.getFullYear()}年${pad(d.getMonth() + 1)}月${pad(d.getDate())}日`, 32)
}

function formatWechatTime(dateInput) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(d.getTime())) return clipText(formatWechatTime(new Date()), 32)
  const pad = (n) => String(n).padStart(2, '0')
  return clipText(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`, 32)
}

function dataValue(value) {
  return { value: value == null ? '' : String(value) }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolvePublicImageUrl(url) {
  if (url == null || typeof url !== 'string') return ''
  const trimmed = url.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  if (trimmed.startsWith('/uploads/') || trimmed.startsWith('/')) {
    return `${PUBLIC_API_BASE_URL}${trimmed}`
  }
  return `${OSS_PUBLIC_ORIGIN}/${trimmed.replace(/^\//, '')}`
}

function parsePayTimeSec(dateInput) {
  if (dateInput == null || dateInput === '') return Math.floor(Date.now() / 1000)
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput)
  if (Number.isNaN(d.getTime())) return Math.floor(Date.now() / 1000)
  return Math.floor(d.getTime() / 1000)
}

function buildDigitalItemPageQuery({ orderId, outTradeNo, itemId }) {
  const params = new URLSearchParams()
  if (outTradeNo) params.set('out_trade_no', outTradeNo)
  if (orderId != null) params.set('id', String(orderId))
  if (itemId != null) params.set('item_id', String(itemId))
  return params.toString()
}

function buildVirtualDeliveryProductList(digitalItems, { orderId, outTradeNo }) {
  const defaultImg = getVirtualDeliveryDefaultProductImg()
  const infoList = (digitalItems || []).map((item) => {
    const img = resolvePublicImageUrl(item.image_url) || defaultImg
    const priceYuan = Number(item.price)
    const entry = {
      product_img: img || defaultImg || 'https://wx.oss.2000gallery.art/default-product.png',
      product_name: clipText(item.title || '数字艺术品', 40),
      product_path_query: buildDigitalItemPageQuery({ orderId, outTradeNo, itemId: item.id }),
      count: Math.max(1, Number(item.quantity) || 1),
    }
    if (Number.isFinite(priceYuan) && priceYuan > 0) {
      entry.single_price = Math.round(priceYuan * 100)
    }
    return entry
  })
  return { info_list: infoList }
}

function buildVirtualDeliveryContentJson({
  curStatus,
  digitalItems,
  orderId,
  outTradeNo,
  sendTimeSec,
}) {
  const wxaPathQuery = buildSubscribeOrderPage({ outTradeNo, orderId })
  const payload = {
    cur_status: curStatus,
    wxa_path_query: wxaPathQuery,
  }

  if (curStatus === 1 || curStatus === 2) {
    payload.product_count = (digitalItems || []).reduce(
      (sum, item) => sum + Math.max(1, Number(item.quantity) || 1),
      0,
    ) || 1
    payload.product_list = buildVirtualDeliveryProductList(digitalItems, { orderId, outTradeNo })
    if (sendTimeSec != null && curStatus === 2) payload.send_time = sendTimeSec
  } else if (curStatus === 3 && sendTimeSec != null) {
    payload.send_time = sendTimeSec
  }

  return JSON.stringify(payload)
}

function buildVirtualDeliveryCheckJson({ payAmountFen, payTimeSec }) {
  return JSON.stringify({
    pay_amount: payAmountFen,
    pay_time: payTimeSec,
  })
}

function isNotifyCodeNotReady(result) {
  const errmsg = String(result?.body?.errmsg || result?.body?.error || '')
  const errcode = result?.body?.errcode
  if (errmsg.includes('notify_code')) return true
  if (errcode === 894020 || errcode === 40001) return false
  return /不存在|not exist|not found/i.test(errmsg)
}

async function markSubscribeSentOnce(redisKey) {
  const exists = await redisClient.get(redisKey)
  if (exists) return false
  await redisClient.setEx(redisKey, SUBSCRIBE_SENT_TTL_SEC, '1')
  return true
}

async function loadOrderNotifyContext({ orderId, outTradeNo }) {
  const where = []
  const params = []
  if (orderId != null) {
    where.push('o.id = ?')
    params.push(Number(orderId))
  } else if (outTradeNo) {
    where.push('o.out_trade_no = ?')
    params.push(String(outTradeNo).trim())
  } else {
    return null
  }

  const [orders] = await db.query(
    `SELECT o.id, o.out_trade_no, o.user_id, o.body, o.total_fee, o.actual_fee, o.trade_state,
            o.transaction_id, o.created_at, o.success_time, wu.openid
     FROM orders o
     JOIN wx_users wu ON wu.id = o.user_id
     WHERE ${where.join(' AND ')}
     LIMIT 1`,
    params,
  )
  if (!orders.length) return null
  const order = orders[0]
  if (!order.openid) return null

  const [items] = await db.query(
    `SELECT oi.type, oi.quantity, oi.price,
            r.title AS right_title,
            COALESCE(da.title, dae.title) AS digital_title,
            oa.title AS artwork_title,
            wa.province, wa.city, wa.district, wa.detail_address
     FROM order_items oi
     LEFT JOIN rights r ON oi.type = 'right' AND oi.right_id = r.id
     ${DIGITAL_ITEM_JOIN_SQL}
     LEFT JOIN original_artworks oa ON oi.type = 'artwork' AND oi.artwork_id = oa.id
     LEFT JOIN wx_user_addresses wa ON oi.address_id = wa.id
     WHERE oi.order_id = ?
     ORDER BY oi.id ASC`,
    [order.id],
  )

  const titles = (items || [])
    .map((row) => row.right_title || row.digital_title || row.artwork_title)
    .filter(Boolean)

  let productTitle = clipText(order.body, 20)
  if (titles.length === 1) productTitle = clipText(titles[0], 20)
  else if (titles.length > 1) productTitle = clipText(`${titles[0]}等${titles.length}件`, 20)

  const addressRow = (items || []).find((row) => row.province || row.detail_address)
  const fullAddress = addressRow
    ? clipText([addressRow.province, addressRow.city, addressRow.district, addressRow.detail_address].filter(Boolean).join(''), 20)
    : '线上交付'

  const payAmount = Number(order.actual_fee ?? order.total_fee)
  const hasDigitalItem = (items || []).some((row) => row.type === 'digital')
  const hasPhysicalItem = (items || []).some((row) => row.type === 'right' || row.type === 'artwork')

  return {
    orderId: order.id,
    outTradeNo: order.out_trade_no,
    openid: order.openid,
    userId: order.user_id,
    productTitle,
    fullAddress,
    payAmountYuan: payAmount,
    payAmountFen: Math.round(payAmount * 100),
    transactionId: order.transaction_id,
    createdAt: order.created_at,
    successTime: order.success_time,
    tradeState: order.trade_state,
    hasDigitalItem,
    hasPhysicalItem,
  }
}

async function loadDigitalDeliveryItems(orderId) {
  const [rows] = await db.query(
    `SELECT oi.id, oi.quantity, oi.price, oi.delivery_qr_code_url,
            COALESCE(da.title, dae.title) AS title,
            COALESCE(da.image_url, dae.image_url) AS image_url
     FROM order_items oi
     ${DIGITAL_ITEM_JOIN_SQL}
     WHERE oi.order_id = ? AND oi.type = 'digital'
     ORDER BY oi.id ASC`,
    [orderId],
  )
  return rows || []
}

async function dispatchVirtualDeliveryNotify({
  scene,
  redisKey,
  openid,
  notifyCode,
  contentJson,
  checkJson,
  orderId,
  outTradeNo,
  allowRetry = false,
}) {
  if (!isVirtualDeliveryNotifyEnabled()) return { skipped: true, reason: 'virtual_delivery_disabled' }
  if (!openid) return { skipped: true, reason: 'missing_openid' }
  if (!notifyCode) return { skipped: true, reason: 'missing_notify_code' }

  if (redisKey) {
    const shouldSend = await markSubscribeSentOnce(redisKey)
    if (!shouldSend) return { skipped: true, reason: 'duplicate' }
  }

  const notifyType = getVirtualDeliveryNotifyType()

  async function callOnce() {
    return setUserNotifyDirect({
      openid,
      notify_type: notifyType,
      notify_code: notifyCode,
      content_json: contentJson,
      check_json: checkJson,
    })
  }

  let result = await callOnce()
  if (!result.ok && allowRetry && isNotifyCodeNotReady(result)) {
    logger.info('虚拟发货服务卡片 notify_code 未就绪，稍后重试', { scene, orderId, outTradeNo })
    await sleep(Math.max(5000, VIRTUAL_DELIVERY_NOTIFY_RETRY_MS))
    result = await callOnce()
  }

  if (!result.ok) {
    logger.warn('虚拟发货服务卡片更新失败', {
      scene,
      orderId,
      outTradeNo,
      errcode: result.body?.errcode,
      error: result.body?.error || result.body?.errmsg,
    })
    if (redisKey) await redisClient.del(redisKey)
    return { ok: false, error: result.body }
  }

  logger.info('虚拟发货服务卡片已更新', { scene, orderId, outTradeNo, notifyType })
  return { ok: true }
}

async function dispatchSubscribeMessage({ scene, redisKey, openid, templateId, data, page, userId, orderId, outTradeNo }) {
  if (!isWxSubscribeNotifyEnabled()) return { skipped: true, reason: 'disabled' }
  if (!templateId) return { skipped: true, reason: 'missing_template' }
  if (!openid) return { skipped: true, reason: 'missing_openid' }

  if (redisKey) {
    const shouldSend = await markSubscribeSentOnce(redisKey)
    if (!shouldSend) return { skipped: true, reason: 'duplicate' }
  }

  const result = await sendSubscribeMessageDirect({
    openid,
    template_id: templateId,
    data,
    page: page || buildSubscribeOrderPage({ outTradeNo, orderId }),
  })

  if (!result.ok) {
    logger.warn('订阅消息发送失败', {
      scene,
      orderId,
      outTradeNo,
      userId,
      errcode: result.body?.errcode,
      error: result.body?.error,
    })
    if (redisKey) await redisClient.del(redisKey)
    return { ok: false, error: result.body }
  }

  logger.info('订阅消息已发送', { scene, orderId, outTradeNo, userId })
  return { ok: true }
}

/** 订单支付成功 */
async function notifyOrderPaid({ outTradeNo, orderId }) {
  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (ctx.hasDigitalItem && !ctx.hasPhysicalItem) {
    return { skipped: true, reason: 'digital_only_use_virtual_delivery' }
  }

  return dispatchSubscribeMessage({
    scene: 'orderPaid',
    redisKey: `subscribe:sent:paid:${ctx.outTradeNo}`,
    openid: ctx.openid,
    templateId: templates.orderPaid,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    data: {
      number1: dataValue(clipText(String(ctx.orderId), 32)),
      amount12: dataValue(formatAmountYuan(ctx.payAmountYuan)),
      thing4: dataValue(ctx.productTitle || '商品'),
      thing8: dataValue(ctx.fullAddress || '—'),
    },
  })
}

/** 待付款提醒（下单后） */
async function notifyPaymentPending({ outTradeNo, orderId }) {
  if (!isPaymentPendingNotifyEnabled()) return { skipped: true, reason: 'payment_pending_disabled' }

  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }

  const created = ctx.createdAt ? new Date(ctx.createdAt) : new Date()
  const deadline = new Date(created.getTime() + Math.max(5, PAYMENT_DEADLINE_MINUTES) * 60 * 1000)

  return dispatchSubscribeMessage({
    scene: 'paymentPending',
    redisKey: `subscribe:sent:pending:${ctx.outTradeNo}`,
    openid: ctx.openid,
    templateId: templates.paymentPending,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    data: {
      thing1: dataValue(ctx.productTitle || '商品'),
      date2: dataValue(formatWechatDate(created)),
      amount3: dataValue(formatAmountYuan(ctx.payAmountYuan)),
      thing6: dataValue(clipText(`请在${PAYMENT_DEADLINE_MINUTES}分钟内完成支付`, 20)),
      time8: dataValue(formatWechatTime(deadline)),
    },
  })
}

/** 订单取消（关单） */
async function notifyOrderCancelled({ outTradeNo, orderId, reason = '订单已关闭' }) {
  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }

  return dispatchSubscribeMessage({
    scene: 'orderCancelled',
    redisKey: `subscribe:sent:cancel:${ctx.outTradeNo}`,
    openid: ctx.openid,
    templateId: templates.orderCancelled,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    data: {
      thing2: dataValue(ctx.productTitle || '商品'),
      amount3: dataValue(formatAmountYuan(ctx.payAmountYuan)),
      thing1: dataValue(clipText(reason, 20)),
      date4: dataValue(formatWechatDateTime(new Date())),
    },
  })
}

/** 退款成功 */
async function notifyRefundSuccess({ outTradeNo, outRefundNo, refundYuan, refundMethod = '原路退回' }) {
  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ outTradeNo })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }

  let amount = refundYuan
  if (amount == null && outRefundNo) {
    const [rows] = await db.query(
      'SELECT amount FROM refund_requests WHERE out_refund_no = ? LIMIT 1',
      [outRefundNo],
    )
    if (rows.length && rows[0].amount) {
      try {
        const parsed = typeof rows[0].amount === 'string' ? JSON.parse(rows[0].amount) : rows[0].amount
        const refundFen = Number(parsed?.refund)
        if (Number.isFinite(refundFen)) amount = refundFen / 100
      } catch {
        // ignore parse error
      }
    }
  }
  if (amount == null) amount = ctx.payAmountYuan

  return dispatchSubscribeMessage({
    scene: 'refundResult',
    redisKey: outRefundNo ? `subscribe:sent:refund:${outRefundNo}` : `subscribe:sent:refund:${ctx.outTradeNo}`,
    openid: ctx.openid,
    templateId: templates.refundResult,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    data: {
      character_string2: dataValue(clipText(ctx.outTradeNo, 32)),
      amount1: dataValue(formatAmountYuan(amount)),
      phrase4: dataValue(clipText('退款成功', 5)),
      thing8: dataValue(clipText(refundMethod, 20)),
    },
  })
}

/** 订单发货 */
async function notifyOrderShipped({
  orderId,
  outTradeNo,
  waybillId,
  deliveryId,
  shipTime,
  trackingHint,
  etaText,
}) {
  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ orderId, outTradeNo })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (!ctx.hasPhysicalItem) return { skipped: true, reason: 'no_physical_item' }

  const shippedAt = shipTime ? new Date(shipTime) : new Date()
  const tracking = clipText(trackingHint || `${deliveryId || '快递'} 已揽件`, 20)
  const eta = clipText(etaText || '以快递实际送达为准', 32)

  return dispatchSubscribeMessage({
    scene: 'orderShipped',
    redisKey: waybillId
      ? `subscribe:sent:shipped:${ctx.orderId}:${waybillId}`
      : `subscribe:sent:shipped:${ctx.orderId}`,
    openid: ctx.openid,
    templateId: templates.orderShipped,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    data: {
      thing1: dataValue(ctx.productTitle || '商品'),
      date4: dataValue(formatWechatDate(shippedAt)),
      thing6: dataValue(tracking),
      date7: dataValue(eta),
      thing8: dataValue(ctx.fullAddress || '—'),
    },
  })
}

/**
 * 数字艺术品支付成功 — 激活「购物（虚拟发货）服务动态」卡片（备货中）
 * notify_code 使用微信支付订单号 transaction_id
 */
async function notifyVirtualDeliveryPreparing({ outTradeNo, orderId, transactionId, payTime }) {
  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (!ctx.hasDigitalItem) return { skipped: true, reason: 'no_digital_item' }

  const notifyCode = String(transactionId || ctx.transactionId || '').trim()
  if (!notifyCode) return { skipped: true, reason: 'missing_transaction_id' }

  const digitalItems = await loadDigitalDeliveryItems(ctx.orderId)
  if (!digitalItems.length) return { skipped: true, reason: 'no_digital_item' }

  const payTimeSec = parsePayTimeSec(payTime ?? ctx.successTime)
  const sendTimeSec = payTimeSec + 24 * 60 * 60
  const contentJson = buildVirtualDeliveryContentJson({
    curStatus: 2,
    digitalItems,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    sendTimeSec,
  })
  const checkJson = buildVirtualDeliveryCheckJson({
    payAmountFen: ctx.payAmountFen,
    payTimeSec,
  })

  return dispatchVirtualDeliveryNotify({
    scene: 'virtualDeliveryPreparing',
    redisKey: `subscribe:virtual:activate:${notifyCode}`,
    openid: ctx.openid,
    notifyCode,
    contentJson,
    checkJson,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    allowRetry: true,
  })
}

/**
 * 数字艺术品交付二维码已上传 — 更新服务卡片为「已发货 / 部分发货」
 * 用户点击卡片进入订单详情页查看领取二维码
 */
async function notifyVirtualDeliveryShipped({ orderId, outTradeNo, orderItemId }) {
  const ctx = await loadOrderNotifyContext({ orderId, outTradeNo })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (!ctx.hasDigitalItem) return { skipped: true, reason: 'no_digital_item' }

  const notifyCode = String(ctx.transactionId || '').trim()
  if (!notifyCode) return { skipped: true, reason: 'missing_transaction_id' }

  const digitalItems = await loadDigitalDeliveryItems(ctx.orderId)
  if (!digitalItems.length) return { skipped: true, reason: 'no_digital_item' }

  const deliveredCount = digitalItems.filter((item) => item.delivery_qr_code_url).length
  const totalCount = digitalItems.length
  const allDelivered = deliveredCount >= totalCount
  const curStatus = allDelivered ? 4 : 3

  const contentJson = buildVirtualDeliveryContentJson({
    curStatus,
    digitalItems: allDelivered ? digitalItems : digitalItems.filter((item) => item.delivery_qr_code_url),
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    sendTimeSec: Math.floor(Date.now() / 1000),
  })

  const redisKey = allDelivered
    ? `subscribe:virtual:delivered:${ctx.orderId}`
    : `subscribe:virtual:partial:${ctx.orderId}:${deliveredCount}:${orderItemId || 'all'}`

  return dispatchVirtualDeliveryNotify({
    scene: allDelivered ? 'virtualDeliveryShipped' : 'virtualDeliveryPartial',
    redisKey,
    openid: ctx.openid,
    notifyCode,
    contentJson,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
  })
}

function fireSubscribeNotify(taskPromise, scene) {
  Promise.resolve(taskPromise).catch((err) => {
    logger.warn('订阅消息异步任务异常', { scene, err: err?.message || err })
  })
}

module.exports = {
  notifyOrderPaid,
  notifyPaymentPending,
  notifyOrderCancelled,
  notifyRefundSuccess,
  notifyOrderShipped,
  notifyVirtualDeliveryPreparing,
  notifyVirtualDeliveryShipped,
  fireSubscribeNotify,
  loadOrderNotifyContext,
}
