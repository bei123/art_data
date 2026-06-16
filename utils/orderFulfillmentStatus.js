/**
 * 订单履约状态：与微信支付 trade_state 分离，覆盖实物物流与数字艺术品交付。
 */

const FULFILLMENT_STATUS = {
  CREATED: 'created',
  AWAITING_PAYMENT: 'awaiting_payment',
  PAYMENT_FAILED: 'payment_failed',
  AWAITING_SHIPMENT: 'awaiting_shipment',
  AWAITING_DELIVERY: 'awaiting_delivery',
  SHIPPED: 'shipped',
  IN_TRANSIT: 'in_transit',
  RECEIVED: 'received',
  DELIVERED: 'delivered',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
  REFUNDED: 'refunded',
}

const STATUS_RANK = {
  [FULFILLMENT_STATUS.CREATED]: 10,
  [FULFILLMENT_STATUS.AWAITING_PAYMENT]: 10,
  [FULFILLMENT_STATUS.PAYMENT_FAILED]: 10,
  [FULFILLMENT_STATUS.AWAITING_SHIPMENT]: 20,
  [FULFILLMENT_STATUS.AWAITING_DELIVERY]: 20,
  [FULFILLMENT_STATUS.SHIPPED]: 30,
  [FULFILLMENT_STATUS.IN_TRANSIT]: 40,
  [FULFILLMENT_STATUS.RECEIVED]: 50,
  [FULFILLMENT_STATUS.DELIVERED]: 50,
  [FULFILLMENT_STATUS.COMPLETED]: 60,
  [FULFILLMENT_STATUS.CANCELLED]: -1,
  [FULFILLMENT_STATUS.CLOSED]: -1,
  [FULFILLMENT_STATUS.REFUNDED]: -1,
}

const STATUS_LABELS = {
  [FULFILLMENT_STATUS.CREATED]: '创建订单',
  [FULFILLMENT_STATUS.AWAITING_PAYMENT]: '待支付',
  [FULFILLMENT_STATUS.PAYMENT_FAILED]: '支付失败',
  [FULFILLMENT_STATUS.AWAITING_SHIPMENT]: '待发货',
  [FULFILLMENT_STATUS.AWAITING_DELIVERY]: '待交付',
  [FULFILLMENT_STATUS.SHIPPED]: '已发货',
  [FULFILLMENT_STATUS.IN_TRANSIT]: '运输中',
  [FULFILLMENT_STATUS.RECEIVED]: '已收货',
  [FULFILLMENT_STATUS.DELIVERED]: '已交付',
  [FULFILLMENT_STATUS.COMPLETED]: '订单完成',
  [FULFILLMENT_STATUS.CANCELLED]: '已撤销',
  [FULFILLMENT_STATUS.CLOSED]: '已关闭',
  [FULFILLMENT_STATUS.REFUNDED]: '已退款',
}

const STATUS_HINTS = {
  [FULFILLMENT_STATUS.CREATED]: '订单已创建，等待用户完成支付。',
  [FULFILLMENT_STATUS.AWAITING_PAYMENT]: '等待用户完成支付。',
  [FULFILLMENT_STATUS.PAYMENT_FAILED]: '支付未完成，用户可重新发起支付或联系客服。',
  [FULFILLMENT_STATUS.AWAITING_SHIPMENT]: '支付成功，等待商家发货。',
  [FULFILLMENT_STATUS.AWAITING_DELIVERY]: '支付成功，等待上传数字藏品交付二维码。',
  [FULFILLMENT_STATUS.SHIPPED]: '商家已发货，等待物流揽收或更新。',
  [FULFILLMENT_STATUS.IN_TRANSIT]: '包裹运输中，请关注物流进度。',
  [FULFILLMENT_STATUS.RECEIVED]: '用户已签收实物商品。',
  [FULFILLMENT_STATUS.DELIVERED]: '数字藏品交付二维码已上传，用户可领取。',
  [FULFILLMENT_STATUS.COMPLETED]: '订单履约已完成。',
  [FULFILLMENT_STATUS.CANCELLED]: '订单已撤销。',
  [FULFILLMENT_STATUS.CLOSED]: '订单已关闭。',
  [FULFILLMENT_STATUS.REFUNDED]: '订单已退款。',
}

const TERMINAL_PHYSICAL = new Set([FULFILLMENT_STATUS.RECEIVED])
const TERMINAL_DIGITAL = new Set([FULFILLMENT_STATUS.DELIVERED])

function hasQrCode(url) {
  return Boolean(url && String(url).trim())
}

function mapPathActionToStatus(actionType) {
  const t = Number(actionType)
  if (!t) return null
  if (t === 300003) return FULFILLMENT_STATUS.RECEIVED
  if (t === 200001 || t === 300002 || t === 300004) return FULFILLMENT_STATUS.IN_TRANSIT
  if (t === 100001 || t === 100002 || t === 100003) return FULFILLMENT_STATUS.SHIPPED
  return FULFILLMENT_STATUS.SHIPPED
}

function resolveFulfillmentKind(items) {
  const types = new Set((items || []).map((item) => item.type))
  const hasPhysical = types.has('right') || types.has('artwork')
  const hasDigital = types.has('digital')
  if (hasPhysical && hasDigital) return 'mixed'
  if (hasDigital) return 'digital'
  if (hasPhysical) return 'physical'
  return 'none'
}

function resolvePhysicalGroupStatus({ tradeState, shipment }) {
  if (tradeState !== 'SUCCESS') return null
  const hasShipment = Boolean(shipment && shipment.waybill_id && shipment.status !== 'cancelled')
  if (!hasShipment) return FULFILLMENT_STATUS.AWAITING_SHIPMENT
  const fromPath = mapPathActionToStatus(shipment.latest_path_action_type)
  return fromPath || FULFILLMENT_STATUS.SHIPPED
}

function resolveDigitalGroupStatus({ tradeState, digitalItems }) {
  if (tradeState !== 'SUCCESS') return null
  if (!digitalItems.length) return null
  const allDelivered = digitalItems.every((item) => hasQrCode(item.delivery_qr_code_url))
  if (allDelivered) return FULFILLMENT_STATUS.DELIVERED
  return FULFILLMENT_STATUS.AWAITING_DELIVERY
}

function isGroupTerminal(status, group) {
  if (!status) return true
  if (group === 'physical') return TERMINAL_PHYSICAL.has(status)
  if (group === 'digital') return TERMINAL_DIGITAL.has(status)
  return false
}

function pickLeastCompleteStatus(statuses) {
  const valid = statuses.filter(Boolean)
  if (!valid.length) return FULFILLMENT_STATUS.COMPLETED
  return valid.reduce((least, current) => {
    const leastRank = STATUS_RANK[least] ?? 999
    const currentRank = STATUS_RANK[current] ?? 999
    return currentRank < leastRank ? current : least
  })
}

function buildFulfillmentResult(code, kind, hintOverride) {
  const text = STATUS_LABELS[code] || '未知状态'
  const hint = hintOverride || STATUS_HINTS[code] || ''
  return {
    code,
    text,
    kind,
    hint,
  }
}

function resolvePaymentTerminalStatus(tradeState, kind) {
  if (tradeState === 'REFUND') return buildFulfillmentResult(FULFILLMENT_STATUS.REFUNDED, kind)
  if (tradeState === 'CLOSED') return buildFulfillmentResult(FULFILLMENT_STATUS.CLOSED, kind)
  if (tradeState === 'REVOKED') return buildFulfillmentResult(FULFILLMENT_STATUS.CANCELLED, kind)
  if (tradeState === 'PAYERROR') return buildFulfillmentResult(FULFILLMENT_STATUS.PAYMENT_FAILED, kind)
  if (tradeState === 'NOTPAY') return buildFulfillmentResult(FULFILLMENT_STATUS.CREATED, kind)
  return null
}

function resolveOrderFulfillmentStatus({
  tradeState,
  items = [],
  shipment = null,
}) {
  const kind = resolveFulfillmentKind(items)
  const paymentTerminal = resolvePaymentTerminalStatus(tradeState, kind)
  if (paymentTerminal) return paymentTerminal

  if (tradeState !== 'SUCCESS') {
    return buildFulfillmentResult(FULFILLMENT_STATUS.AWAITING_PAYMENT, kind)
  }

  const digitalItems = items.filter((item) => item.type === 'digital')
  const hasPhysical = kind === 'physical' || kind === 'mixed'
  const hasDigital = kind === 'digital' || kind === 'mixed'

  const groupStatuses = []
  if (hasPhysical) {
    groupStatuses.push({
      group: 'physical',
      status: resolvePhysicalGroupStatus({ tradeState, shipment }),
    })
  }
  if (hasDigital) {
    groupStatuses.push({
      group: 'digital',
      status: resolveDigitalGroupStatus({ tradeState, digitalItems }),
    })
  }

  if (!groupStatuses.length) {
    return buildFulfillmentResult(FULFILLMENT_STATUS.COMPLETED, kind, '支付成功。')
  }

  const allTerminal = groupStatuses.every(({ group, status }) => isGroupTerminal(status, group))
  if (allTerminal) {
    return buildFulfillmentResult(FULFILLMENT_STATUS.COMPLETED, kind)
  }

  const aggregate = pickLeastCompleteStatus(groupStatuses.map((row) => row.status))
  if (kind === 'digital' && aggregate === FULFILLMENT_STATUS.DELIVERED) {
    return buildFulfillmentResult(FULFILLMENT_STATUS.COMPLETED, kind)
  }

  return buildFulfillmentResult(aggregate, kind)
}

function buildFulfillmentTimelineStages(fulfillment, { paidAt, shipmentCreatedAt, qrUploadedAt, receivedAt } = {}) {
  const stages = [{
    stage: 'ORDER_CREATED',
    title: '创建订单',
    description: '订单已创建',
  }]

  if (fulfillment.code === FULFILLMENT_STATUS.PAYMENT_FAILED) {
    stages.push({ stage: 'PAYMENT_FAILED', title: '支付失败', description: fulfillment.hint })
    return stages
  }

  if (fulfillment.code !== FULFILLMENT_STATUS.CREATED && fulfillment.code !== FULFILLMENT_STATUS.AWAITING_PAYMENT) {
    stages.push({
      stage: 'PAID',
      at: paidAt || null,
      title: '支付成功',
      description: '用户已完成支付',
    })
  }

  if ([FULFILLMENT_STATUS.REFUNDED, FULFILLMENT_STATUS.CLOSED, FULFILLMENT_STATUS.CANCELLED].includes(fulfillment.code)) {
    stages.push({
      stage: fulfillment.code.toUpperCase(),
      title: fulfillment.text,
      description: fulfillment.hint,
    })
    return stages
  }

  const kind = fulfillment.kind
  const physicalKinds = new Set(['physical', 'mixed'])
  const digitalKinds = new Set(['digital', 'mixed'])
  const rank = STATUS_RANK[fulfillment.code] ?? 0

  if (physicalKinds.has(kind) && rank >= STATUS_RANK[FULFILLMENT_STATUS.AWAITING_SHIPMENT]) {
    stages.push({
      stage: 'AWAITING_SHIPMENT',
      title: '待发货',
      description: '等待商家创建运单并发货',
    })
  }
  if (digitalKinds.has(kind) && rank >= STATUS_RANK[FULFILLMENT_STATUS.AWAITING_DELIVERY]) {
    stages.push({
      stage: 'AWAITING_DELIVERY',
      title: '待交付',
      description: '等待上传数字藏品交付二维码',
    })
  }

  if (rank >= STATUS_RANK[FULFILLMENT_STATUS.SHIPPED]) {
    stages.push({
      stage: 'SHIPPED',
      at: shipmentCreatedAt || null,
      title: '已发货',
      description: '商家已发货',
    })
  }
  if (rank >= STATUS_RANK[FULFILLMENT_STATUS.IN_TRANSIT]) {
    stages.push({
      stage: 'IN_TRANSIT',
      title: '运输中',
      description: '包裹运输中',
    })
  }
  if (rank >= STATUS_RANK[FULFILLMENT_STATUS.RECEIVED]) {
    stages.push({
      stage: 'RECEIVED',
      at: receivedAt || null,
      title: '已收货',
      description: '用户已签收',
    })
  }
  if (digitalKinds.has(kind) && rank >= STATUS_RANK[FULFILLMENT_STATUS.DELIVERED]) {
    stages.push({
      stage: 'DELIVERED',
      at: qrUploadedAt || null,
      title: '已交付',
      description: '数字藏品二维码已交付',
    })
  }
  if (fulfillment.code === FULFILLMENT_STATUS.COMPLETED) {
    stages.push({
      stage: 'COMPLETED',
      title: '订单完成',
      description: '订单履约已完成',
    })
  }

  return stages
}

module.exports = {
  FULFILLMENT_STATUS,
  STATUS_LABELS,
  mapPathActionToStatus,
  resolveFulfillmentKind,
  resolveOrderFulfillmentStatus,
  buildFulfillmentTimelineStages,
  pickLatestPathNode,
}

function pickLatestPathNode(pathItemList) {
  if (!Array.isArray(pathItemList) || !pathItemList.length) return null
  return pathItemList.reduce((latest, item) => {
    if (!item || typeof item !== 'object') return latest
    if (!latest) return item
    const latestTs = Number(latest.action_time) || 0
    const itemTs = Number(item.action_time) || 0
    if (itemTs > latestTs) return item
    if (itemTs < latestTs) return latest
    const latestType = Number(latest.action_type) || 0
    const itemType = Number(item.action_type) || 0
    return itemType >= latestType ? item : latest
  }, null)
}
