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
const PAYMENT_PENDING_REMIND_BEFORE_MINUTES = parseInt(
  process.env.WX_SUBSCRIBE_PAYMENT_PENDING_REMIND_BEFORE_MINUTES || '5',
  10,
)
const PENDING_SCHEDULE_KEY = 'subscribe:pending:schedule'
const PENDING_SCHEDULE_POLL_MS = parseInt(process.env.WX_SUBSCRIBE_PAYMENT_PENDING_POLL_MS || '30000', 10)
const VIRTUAL_DELIVERY_NOTIFY_RETRY_MS = parseInt(process.env.WX_VIRTUAL_DELIVERY_NOTIFY_RETRY_MS || '65000', 10)

let paymentPendingSchedulerTimer = null

function getPaymentDeadlineMs(createdAt) {
  const created = createdAt ? new Date(createdAt) : new Date()
  return created.getTime() + Math.max(5, PAYMENT_DEADLINE_MINUTES) * 60 * 1000
}

function getPaymentPendingSendAtMs(createdAt) {
  const deadlineMs = getPaymentDeadlineMs(createdAt)
  const remindBeforeMs = Math.max(0, PAYMENT_PENDING_REMIND_BEFORE_MINUTES) * 60 * 1000
  return deadlineMs - remindBeforeMs
}

function isSubscribeUserRefused(result) {
  return result?.body?.errcode === 43101
}

function clipText(value, maxLen) {
  if (value == null) return ''
  const str = String(value).trim()
  if (!str) return ''
  return [...str].slice(0, maxLen).join('')
}

/** 微信 number 类型字段仅允许纯数字 */
function formatSubscribeNumberValue(value, fallback = '0') {
  const digits = String(value ?? '').replace(/\D/g, '')
  if (digits) return clipText(digits, 32)
  const fallbackDigits = String(fallback ?? '').replace(/\D/g, '')
  if (fallbackDigits) return clipText(fallbackDigits, 32)
  return '0'
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
  if (!order.openid) {
    logger.warn('订单通知上下文缺少 openid', {
      orderId: order.id,
      outTradeNo: order.out_trade_no,
      userId: order.user_id,
    })
    return null
  }

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
  force = false,
}) {
  if (!isVirtualDeliveryNotifyEnabled()) return { skipped: true, reason: 'virtual_delivery_disabled' }
  if (!openid) return { skipped: true, reason: 'missing_openid' }
  if (!notifyCode) return { skipped: true, reason: 'missing_notify_code' }

  if (redisKey) {
    if (force) await redisClient.del(redisKey)
    else {
      const shouldSend = await markSubscribeSentOnce(redisKey)
      if (!shouldSend) return { skipped: true, reason: 'duplicate' }
    }
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

async function dispatchSubscribeMessage({
  scene,
  redisKey,
  openid,
  templateId,
  data,
  page,
  userId,
  orderId,
  outTradeNo,
  force = false,
}) {
  if (!isWxSubscribeNotifyEnabled()) return { skipped: true, reason: 'disabled' }
  if (!templateId) return { skipped: true, reason: 'missing_template' }
  if (!openid) return { skipped: true, reason: 'missing_openid' }

  if (redisKey) {
    if (force) await redisClient.del(redisKey)
    else {
      const shouldSend = await markSubscribeSentOnce(redisKey)
      if (!shouldSend) return { skipped: true, reason: 'duplicate' }
    }
  }

  const result = await sendSubscribeMessageDirect({
    openid,
    template_id: templateId,
    data,
    page: page || buildSubscribeOrderPage({ outTradeNo, orderId }),
  })

  if (!result.ok) {
    const logPayload = {
      scene,
      orderId,
      outTradeNo,
      userId,
      errcode: result.body?.errcode,
      error: result.body?.error,
    }
    if (isSubscribeUserRefused(result)) {
      logger.info('订阅消息未送达（用户未订阅或已拒绝）', logPayload)
    } else {
      logger.warn('订阅消息发送失败', logPayload)
    }
    if (redisKey) await redisClient.del(redisKey)
    return { ok: false, error: result.body }
  }

  logger.info('订阅消息已发送', { scene, orderId, outTradeNo, userId })
  return { ok: true }
}

/** 订单支付成功 */
async function notifyOrderPaid({ outTradeNo, orderId, force = false }) {
  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }

  const addressText = ctx.hasDigitalItem && !ctx.hasPhysicalItem
    ? '线上交付'
    : (ctx.fullAddress || '—')

  return dispatchSubscribeMessage({
    scene: 'orderPaid',
    redisKey: `subscribe:sent:paid:${ctx.outTradeNo}`,
    openid: ctx.openid,
    templateId: templates.orderPaid,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    force,
    data: {
      number1: dataValue(formatSubscribeNumberValue(ctx.outTradeNo, ctx.orderId)),
      amount12: dataValue(formatAmountYuan(ctx.payAmountYuan)),
      thing4: dataValue(ctx.productTitle || '商品'),
      thing8: dataValue(addressText),
    },
  })
}

/** 待付款提醒（在支付截止前 N 分钟发送） */
async function notifyPaymentPending({ outTradeNo, orderId, force = false, ignoreChecks = false }) {
  if (!isPaymentPendingNotifyEnabled()) return { skipped: true, reason: 'payment_pending_disabled' }

  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (!ignoreChecks && ctx.tradeState && ctx.tradeState !== 'NOTPAY') {
    return { skipped: true, reason: 'order_not_unpaid' }
  }

  const created = ctx.createdAt ? new Date(ctx.createdAt) : new Date()
  const deadlineMs = getPaymentDeadlineMs(created)
  const deadline = new Date(deadlineMs)
  if (!ignoreChecks && Date.now() >= deadlineMs) {
    return { skipped: true, reason: 'past_deadline' }
  }

  const remindMinutes = Math.max(1, PAYMENT_PENDING_REMIND_BEFORE_MINUTES)

  return dispatchSubscribeMessage({
    scene: 'paymentPending',
    redisKey: `subscribe:sent:pending:${ctx.outTradeNo}`,
    openid: ctx.openid,
    templateId: templates.paymentPending,
    userId: ctx.userId,
    orderId: ctx.orderId,
    outTradeNo: ctx.outTradeNo,
    force,
    data: {
      thing1: dataValue(ctx.productTitle || '商品'),
      date2: dataValue(formatWechatDate(created)),
      amount3: dataValue(formatAmountYuan(ctx.payAmountYuan)),
      thing6: dataValue(clipText(`距离支付截止仅剩${remindMinutes}分钟`, 20)),
      time8: dataValue(formatWechatTime(deadline)),
    },
  })
}

/** 统一下单成功后排期待付款提醒（截止前 N 分钟） */
async function schedulePaymentPendingReminder({ outTradeNo, orderId, createdAt }) {
  if (!isPaymentPendingNotifyEnabled()) return { skipped: true, reason: 'payment_pending_disabled' }
  if (!outTradeNo && orderId == null) return { skipped: true, reason: 'missing_order_ref' }

  const ctx = await loadOrderNotifyContext({ outTradeNo, orderId })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (ctx.tradeState && ctx.tradeState !== 'NOTPAY') {
    return { skipped: true, reason: 'order_not_unpaid' }
  }

  const created = createdAt ?? ctx.createdAt
  const deadlineMs = getPaymentDeadlineMs(created)
  const sendAtMs = getPaymentPendingSendAtMs(created)
  if (Date.now() >= deadlineMs) {
    return { skipped: true, reason: 'past_deadline' }
  }

  await redisClient.zAdd(PENDING_SCHEDULE_KEY, {
    score: sendAtMs,
    value: String(ctx.outTradeNo).trim(),
  })

  logger.info('待付款提醒已排期', {
    outTradeNo: ctx.outTradeNo,
    orderId: ctx.orderId,
    sendAt: new Date(sendAtMs).toISOString(),
    deadline: new Date(deadlineMs).toISOString(),
    remindBeforeMinutes: PAYMENT_PENDING_REMIND_BEFORE_MINUTES,
  })

  return { ok: true, sendAtMs, deadlineMs }
}

async function cancelPaymentPendingReminder(outTradeNo) {
  if (!outTradeNo) return { ok: true, removed: 0 }
  const clean = String(outTradeNo).trim()
  if (!clean) return { ok: true, removed: 0 }
  const removed = await redisClient.zRem(PENDING_SCHEDULE_KEY, clean)
  if (removed > 0) {
    logger.info('待付款提醒排期已取消', { outTradeNo: clean })
  }
  return { ok: true, removed }
}

async function processDuePaymentPendingReminders() {
  if (!isPaymentPendingNotifyEnabled()) return { processed: 0 }

  const now = Date.now()
  const dueItems = await redisClient.zRangeByScore(PENDING_SCHEDULE_KEY, 0, now, {
    LIMIT: { offset: 0, count: 30 },
  })

  let processed = 0
  for (const outTradeNo of dueItems || []) {
    const ctx = await loadOrderNotifyContext({ outTradeNo })
    if (!ctx || (ctx.tradeState && ctx.tradeState !== 'NOTPAY')) {
      await redisClient.zRem(PENDING_SCHEDULE_KEY, outTradeNo)
      continue
    }

    const removed = await redisClient.zRem(PENDING_SCHEDULE_KEY, outTradeNo)
    if (!removed) continue
    processed += 1
    await notifyPaymentPending({ outTradeNo }).catch((err) => {
      logger.warn('待付款提醒发送异常', { outTradeNo, err: err?.message || err })
    })
  }

  return { processed }
}

function startPaymentPendingReminderScheduler() {
  if (String(process.env.WX_SUBSCRIBE_PAYMENT_PENDING_SCHEDULER || 'true').toLowerCase() === 'false') {
    return
  }
  if (paymentPendingSchedulerTimer) return

  paymentPendingSchedulerTimer = setInterval(() => {
    processDuePaymentPendingReminders().catch((err) => {
      logger.warn('待付款提醒调度异常', { err: err?.message || err })
    })
  }, Math.max(10000, PENDING_SCHEDULE_POLL_MS))

  setTimeout(() => {
    processDuePaymentPendingReminders().catch((err) => {
      logger.warn('待付款提醒启动扫描异常', { err: err?.message || err })
    })
  }, 5000)

  logger.info('待付款提醒调度已启动', {
    pollMs: PENDING_SCHEDULE_POLL_MS,
    deadlineMinutes: PAYMENT_DEADLINE_MINUTES,
    remindBeforeMinutes: PAYMENT_PENDING_REMIND_BEFORE_MINUTES,
  })
}

/** 订单取消（关单） */
async function notifyOrderCancelled({ outTradeNo, orderId, reason = '订单已关闭', force = false }) {
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
    force,
    data: {
      thing2: dataValue(ctx.productTitle || '商品'),
      amount3: dataValue(formatAmountYuan(ctx.payAmountYuan)),
      thing1: dataValue(clipText(reason, 20)),
      date4: dataValue(formatWechatDateTime(new Date())),
    },
  })
}

/** 退款成功 */
async function notifyRefundSuccess({
  outTradeNo,
  outRefundNo,
  refundYuan,
  refundMethod = '原路退回',
  force = false,
}) {
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
    force,
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
  force = false,
  ignoreChecks = false,
}) {
  const templates = getWxSubscribeTemplates()
  const ctx = await loadOrderNotifyContext({ orderId, outTradeNo })
  if (!ctx) return { skipped: true, reason: 'order_not_found' }
  if (!ignoreChecks && !ctx.hasPhysicalItem) return { skipped: true, reason: 'no_physical_item' }

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
    force,
    data: {
      thing1: dataValue(ctx.productTitle || '商品'),
      date4: dataValue(formatWechatDate(shippedAt)),
      thing6: dataValue(tracking),
      date7: dataValue(eta),
      thing8: dataValue(ctx.fullAddress || '—'),
    },
  })
}

const RESEND_SCENES = [
  {
    key: 'paymentPending',
    label: '待付款提醒（立即发送）',
    description: '向未支付订单立即发送待付款订阅消息',
  },
  {
    key: 'paymentPendingSchedule',
    label: '待付款提醒（重新排期）',
    description: '按截止前 N 分钟重新写入 Redis 排期；sendImmediately=true 则下一分钟扫描内发送',
  },
  {
    key: 'orderPaid',
    label: '订单支付成功',
    description: '支付成功订阅消息（含数字/实物/混合订单）',
  },
  {
    key: 'orderCancelled',
    label: '订单取消',
    description: '订单关闭/取消通知',
  },
  {
    key: 'refundResult',
    label: '退款结果',
    description: '可传 out_refund_no；不传则取该订单最近一条成功退款',
  },
  {
    key: 'orderShipped',
    label: '订单发货',
    description: '可传 waybill_id / delivery_id；不传则从 order_shipments 取最近一条',
  },
  {
    key: 'virtualDeliveryPreparing',
    label: '数字艺术品 · 备货中（服务卡片）',
    description: '激活虚拟发货服务卡片 cur_status=2',
  },
  {
    key: 'virtualDeliveryShipped',
    label: '数字艺术品 · 已发货（服务卡片）',
    description: '二维码已上传后更新服务卡片；可传 order_item_id',
  },
]

function adminNotifyResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function formatNotifyTaskResult(result) {
  if (result?.skipped) {
    return adminNotifyResult(409, {
      success: false,
      skipped: true,
      reason: result.reason,
      detail: result,
    })
  }
  if (result?.ok === false) {
    const errBody = result.error || {}
    return adminNotifyResult(502, {
      success: false,
      error: errBody.error || errBody.errmsg || '发送失败',
      errcode: errBody.errcode,
      detail: result,
    })
  }
  return adminNotifyResult(200, { success: true, detail: result })
}

async function loadLatestActiveShipment(orderId) {
  try {
    const [rows] = await db.query(
      `SELECT waybill_id, delivery_id, created_at
       FROM order_shipments
       WHERE order_id = ? AND status = 'active'
       ORDER BY id DESC
       LIMIT 1`,
      [orderId],
    )
    return rows[0] || null
  } catch {
    return null
  }
}

async function loadRefundForResend(outTradeNo, outRefundNo) {
  if (outRefundNo) {
    const [rows] = await db.query(
      'SELECT out_refund_no, amount, status FROM refund_requests WHERE out_refund_no = ? LIMIT 1',
      [outRefundNo],
    )
    return rows[0] || null
  }
  const [rows] = await db.query(
    `SELECT out_refund_no, amount, status
     FROM refund_requests
     WHERE out_trade_no = ? AND status = 'SUCCESS'
     ORDER BY id DESC
     LIMIT 1`,
    [outTradeNo],
  )
  return rows[0] || null
}

function getResendScenes() {
  return adminNotifyResult(200, { scenes: RESEND_SCENES })
}

async function resendSubscribeNotify(req) {
  const body = req.body || {}
  const scene = String(body.scene || '').trim()
  const force = Boolean(body.force)
  const ignoreChecks = Boolean(body.ignoreChecks)
  const orderIdRaw = body.orderId ?? body.order_id
  const orderId = orderIdRaw != null && String(orderIdRaw).trim() !== ''
    ? parseInt(String(orderIdRaw), 10)
    : null
  const outTradeNo = body.out_trade_no || body.outTradeNo || null

  const sceneDef = RESEND_SCENES.find((item) => item.key === scene)
  if (!sceneDef) {
    return adminNotifyResult(400, {
      error: '缺少或无效的 scene',
      supportedScenes: RESEND_SCENES.map((item) => item.key),
    })
  }
  if ((!orderId || Number.isNaN(orderId)) && !outTradeNo) {
    return adminNotifyResult(400, { error: '请提供 orderId 或 out_trade_no' })
  }

  const base = {
    orderId: orderId && !Number.isNaN(orderId) ? orderId : undefined,
    outTradeNo: outTradeNo ? String(outTradeNo).trim() : undefined,
    force,
    ignoreChecks,
  }

  let result

  switch (scene) {
    case 'paymentPending':
      result = await notifyPaymentPending(base)
      break
    case 'paymentPendingSchedule': {
      if (body.sendImmediately) {
        const ctx = await loadOrderNotifyContext(base)
        if (!ctx) return adminNotifyResult(404, { error: '订单不存在' })
        if (!ignoreChecks && ctx.tradeState && ctx.tradeState !== 'NOTPAY') {
          return adminNotifyResult(409, { success: false, reason: 'order_not_unpaid' })
        }
        await redisClient.zAdd(PENDING_SCHEDULE_KEY, {
          score: Date.now(),
          value: String(ctx.outTradeNo).trim(),
        })
        result = {
          ok: true,
          scheduled: true,
          immediate: true,
          outTradeNo: ctx.outTradeNo,
          sendAtMs: Date.now(),
        }
      } else {
        result = await schedulePaymentPendingReminder(base)
      }
      break
    }
    case 'orderPaid':
      result = await notifyOrderPaid(base)
      break
    case 'orderCancelled':
      result = await notifyOrderCancelled({
        ...base,
        reason: body.reason || '订单已关闭',
      })
      break
    case 'refundResult': {
      const ctx = await loadOrderNotifyContext(base)
      if (!ctx) return adminNotifyResult(404, { error: '订单不存在' })
      const refundRow = await loadRefundForResend(ctx.outTradeNo, body.out_refund_no || body.outRefundNo)
      if (!refundRow && !body.out_refund_no && !body.outRefundNo) {
        return adminNotifyResult(404, { error: '未找到可补发的退款记录，请传 out_refund_no' })
      }
      result = await notifyRefundSuccess({
        outTradeNo: ctx.outTradeNo,
        outRefundNo: body.out_refund_no || body.outRefundNo || refundRow?.out_refund_no,
        refundMethod: body.refund_method || body.refundMethod || '原路退回',
        force,
      })
      break
    }
    case 'orderShipped': {
      const ctx = await loadOrderNotifyContext(base)
      if (!ctx) return adminNotifyResult(404, { error: '订单不存在' })
      const shipment = await loadLatestActiveShipment(ctx.orderId)
      const waybillId = body.waybill_id || body.waybillId || shipment?.waybill_id
      const deliveryId = body.delivery_id || body.deliveryId || shipment?.delivery_id
      if (!waybillId && !ignoreChecks) {
        return adminNotifyResult(400, { error: '无发货记录，请传 waybill_id 或先完成物流发货' })
      }
      result = await notifyOrderShipped({
        orderId: ctx.orderId,
        outTradeNo: ctx.outTradeNo,
        waybillId,
        deliveryId,
        shipTime: body.ship_time || body.shipTime || shipment?.created_at,
        trackingHint: body.tracking_hint || body.trackingHint,
        etaText: body.eta_text || body.etaText,
        force,
        ignoreChecks,
      })
      break
    }
    case 'virtualDeliveryPreparing':
      result = await notifyVirtualDeliveryPreparing({
        ...base,
        transactionId: body.transaction_id || body.transactionId,
        payTime: body.pay_time || body.payTime,
        force,
        allowRetry: true,
      })
      break
    case 'virtualDeliveryShipped':
      result = await notifyVirtualDeliveryShipped({
        ...base,
        orderItemId: body.order_item_id || body.orderItemId,
        force,
      })
      break
    default:
      return adminNotifyResult(400, { error: '不支持的场景', scene })
  }

  const formatted = formatNotifyTaskResult(result)
  if (formatted.ok) {
    logger.info('订阅消息补发完成', {
      scene,
      orderId: base.orderId,
      outTradeNo: base.outTradeNo,
      force,
      ignoreChecks,
    })
  }
  return formatted
}

/**
 * 数字艺术品支付成功 — 激活「购物（虚拟发货）服务动态」卡片（备货中）
 * notify_code 使用微信支付订单号 transaction_id
 */
async function notifyVirtualDeliveryPreparing({
  outTradeNo,
  orderId,
  transactionId,
  payTime,
  force = false,
  allowRetry = false,
}) {
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
    allowRetry,
    force,
  })
}

/**
 * 数字艺术品交付二维码已上传 — 更新服务卡片为「已发货 / 部分发货」
 * 用户点击卡片进入订单详情页查看领取二维码
 */
async function notifyVirtualDeliveryShipped({ orderId, outTradeNo, orderItemId, force = false }) {
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
    force,
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
  schedulePaymentPendingReminder,
  cancelPaymentPendingReminder,
  startPaymentPendingReminderScheduler,
  notifyOrderCancelled,
  notifyRefundSuccess,
  notifyOrderShipped,
  notifyVirtualDeliveryPreparing,
  notifyVirtualDeliveryShipped,
  getResendScenes,
  resendSubscribeNotify,
  fireSubscribeNotify,
  loadOrderNotifyContext,
}
