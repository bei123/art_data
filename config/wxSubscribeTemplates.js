/**
 * 微信小程序订阅消息私有模板（priTmplId）
 * 可通过环境变量覆盖；未配置 priTmplId 的场景将跳过发送。
 */

const DEFAULT_TEMPLATES = {
  /** 订单取消通知 */
  orderCancelled: 'eRo3ZqegpqBpvm03bYz69SEUxw5s28xYsUG0_2F2QFo',
  /** 退款结果通知 */
  refundResult: 'TqINQeQTovq4TeOt8n93KaOH7ZzaDApsrvhV-20XLYs',
  /** 待付款提醒 */
  paymentPending: '3XayJ63OyXUiOXC2XQXw2WXD_fjx1PLuMPD28HjJvBY',
  /** 购物（虚拟发货）服务动态 — 服务卡片，非普通订阅文案，暂不自动下发 */
  virtualDelivery: 'inIqNTjUpx2vNBgGvBg4TAuHeC9m9nJL16WyxkqcB5o',
  /** 订单发货提醒 */
  orderShipped: 'n5W2-XXBQ8d279lE8AJ-3mM6Y8KTmNU0w9UUcTBizs8',
  /** 订单支付成功通知 */
  orderPaid: 'cFih0vORYpwPHBZpAXKgKhM_9OHfD3xHAuHeJv0NZSs',
}

function readTemplateId(envKey, fallback) {
  const raw = process.env[envKey]
  if (raw === '') return ''
  if (raw != null && String(raw).trim() !== '') return String(raw).trim()
  return fallback
}

function getWxSubscribeTemplates() {
  return {
    orderCancelled: readTemplateId('WX_SUBSCRIBE_TMPL_ORDER_CANCELLED', DEFAULT_TEMPLATES.orderCancelled),
    refundResult: readTemplateId('WX_SUBSCRIBE_TMPL_REFUND_RESULT', DEFAULT_TEMPLATES.refundResult),
    paymentPending: readTemplateId('WX_SUBSCRIBE_TMPL_PAYMENT_PENDING', DEFAULT_TEMPLATES.paymentPending),
    virtualDelivery: readTemplateId('WX_SUBSCRIBE_TMPL_VIRTUAL_DELIVERY', DEFAULT_TEMPLATES.virtualDelivery),
    orderShipped: readTemplateId('WX_SUBSCRIBE_TMPL_ORDER_SHIPPED', DEFAULT_TEMPLATES.orderShipped),
    orderPaid: readTemplateId('WX_SUBSCRIBE_TMPL_ORDER_PAID', DEFAULT_TEMPLATES.orderPaid),
  }
}

function isWxSubscribeNotifyEnabled() {
  if (String(process.env.WX_SUBSCRIBE_ENABLED || 'true').toLowerCase() === 'false') return false
  if (!process.env.WX_APPID || !process.env.WX_SECRET) return false
  return true
}

function isPaymentPendingNotifyEnabled() {
  if (String(process.env.WX_SUBSCRIBE_SEND_PAYMENT_PENDING || 'true').toLowerCase() === 'false') return false
  return true
}

/** 购物（虚拟发货）服务动态 notify_type，默认 2003 */
function getVirtualDeliveryNotifyType() {
  const raw = process.env.WX_VIRTUAL_DELIVERY_NOTIFY_TYPE
  const n = parseInt(String(raw ?? '2003'), 10)
  return Number.isFinite(n) && n > 0 ? n : 2003
}

function isVirtualDeliveryNotifyEnabled() {
  if (String(process.env.WX_VIRTUAL_DELIVERY_ENABLED || 'true').toLowerCase() === 'false') return false
  return isWxSubscribeNotifyEnabled()
}

function getVirtualDeliveryDefaultProductImg() {
  const raw = process.env.WX_VIRTUAL_DELIVERY_DEFAULT_PRODUCT_IMG
  if (raw != null && String(raw).trim() !== '') return String(raw).trim()
  return ''
}

/** 小程序订单详情页路径（不含 query），默认 pages/orders/detail */
function getSubscribeOrderPagePath() {
  const raw = process.env.WX_SUBSCRIBE_ORDER_PAGE
  const path = raw != null && String(raw).trim() !== '' ? String(raw).trim() : 'pages/orders/detail'
  return path.replace(/^\//, '')
}

function buildSubscribeOrderPage({ outTradeNo, orderId }) {
  const base = getSubscribeOrderPagePath()
  const params = new URLSearchParams()
  if (outTradeNo) params.set('out_trade_no', outTradeNo)
  if (orderId != null) params.set('id', String(orderId))
  const qs = params.toString()
  return qs ? `${base}?${qs}` : base
}

module.exports = {
  getWxSubscribeTemplates,
  isWxSubscribeNotifyEnabled,
  isPaymentPendingNotifyEnabled,
  isVirtualDeliveryNotifyEnabled,
  getVirtualDeliveryNotifyType,
  getVirtualDeliveryDefaultProductImg,
  buildSubscribeOrderPage,
}
