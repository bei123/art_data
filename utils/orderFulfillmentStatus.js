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
  REFUNDING: 'refunding',
  REFUNDED: 'refunded',
}

const ACTIVE_REFUND_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING']
const COMPLETED_REFUND_STATUSES = ['SUCCESS']

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
  [FULFILLMENT_STATUS.REFUNDING]: 65,
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
  [FULFILLMENT_STATUS.REFUNDING]: '退款中',
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
  [FULFILLMENT_STATUS.CLOSED]: '订单未支付或已超时关闭。',
  [FULFILLMENT_STATUS.REFUNDING]: '退款申请已提交，等待微信退款到账。',
  [FULFILLMENT_STATUS.REFUNDED]: '订单已完成退款。',
}

const TERMINAL_PHYSICAL = new Set([FULFILLMENT_STATUS.RECEIVED])
const TERMINAL_DIGITAL = new Set([FULFILLMENT_STATUS.DELIVERED])

function hasQrCode(url) {
  return Boolean(url && String(url).trim())
}

function isDigitalItemFullyDelivered(item) {
  if (!item) return false
  const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1
  if (Array.isArray(item.delivery_units) && item.delivery_units.length > 0) {
    const filled = item.delivery_units.filter((u) => hasQrCode(u.qr_code_url)).length
    return filled >= Math.max(qty, item.delivery_units.length)
  }
  return hasQrCode(item.delivery_qr_code_url)
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
  const allDelivered = digitalItems.every((item) => isDigitalItemFullyDelivered(item))
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

function resolveRefundFulfillmentStatus(tradeState, refundStatus, kind) {
  const refundState = refundStatus?.status || null

  if (tradeState === 'REFUND' || COMPLETED_REFUND_STATUSES.includes(refundState)) {
    return buildFulfillmentResult(FULFILLMENT_STATUS.REFUNDED, kind)
  }

  if (ACTIVE_REFUND_STATUSES.includes(refundState)) {
    let hint = STATUS_HINTS[FULFILLMENT_STATUS.REFUNDING]
    if (refundState === 'PENDING') {
      hint = '退款申请待审批，审批通过后将提交微信退款。'
    } else if (refundState === 'APPROVED') {
      hint = '退款已审批，正在提交微信处理。'
    } else if (refundState === 'PROCESSING') {
      hint = '退款已提交微信，等待到账。'
    }
    return buildFulfillmentResult(FULFILLMENT_STATUS.REFUNDING, kind, hint)
  }

  return null
}

function pickEffectiveRefundRow(rows) {
  if (!Array.isArray(rows) || !rows.length) return null

  const sorted = [...rows].sort((a, b) => {
    const idA = Number(a.id) || 0
    const idB = Number(b.id) || 0
    return idB - idA
  })

  const active = sorted.find((row) => ACTIVE_REFUND_STATUSES.includes(row.status))
  if (active) return active

  const completed = sorted.find((row) => COMPLETED_REFUND_STATUSES.includes(row.status))
  if (completed) return completed

  return sorted[0]
}

function mapRefundRowToStatus(row) {
  if (!row) return null
  return {
    id: row.id,
    status: row.status,
    wx_refund_id: row.wx_refund_id || null,
    created_at: row.created_at,
    out_refund_no: row.out_refund_no || null,
  }
}

function resolvePaymentTerminalStatus(tradeState, kind) {
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
  refundStatus = null,
}) {
  const kind = resolveFulfillmentKind(items)

  const refundFulfillment = resolveRefundFulfillmentStatus(tradeState, refundStatus, kind)
  if (refundFulfillment) return refundFulfillment

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
  if (fulfillment.code === FULFILLMENT_STATUS.REFUNDING) {
    const stages = []
    if (paidAt) {
      stages.push({
        stage: 'PAID',
        at: paidAt,
        title: '支付成功',
        description: '用户已完成支付',
      })
    }
    stages.push({
      stage: 'REFUND_IN_PROGRESS',
      title: '退款中',
      description: fulfillment.hint,
    })
    return stages
  }

  const terminalCodes = [
    FULFILLMENT_STATUS.REFUNDED,
    FULFILLMENT_STATUS.CLOSED,
    FULFILLMENT_STATUS.CANCELLED,
  ]

  if (terminalCodes.includes(fulfillment.code)) {
    const stages = []
    if (fulfillment.code === FULFILLMENT_STATUS.REFUNDED && paidAt) {
      stages.push({
        stage: 'PAID',
        at: paidAt,
        title: '支付成功',
        description: '用户已完成支付',
      })
    }
    stages.push({
      stage: fulfillment.code === FULFILLMENT_STATUS.CANCELLED
        ? 'ORDER_CANCELLED'
        : fulfillment.code === FULFILLMENT_STATUS.REFUNDED
          ? 'ORDER_REFUNDED'
          : 'ORDER_CLOSED',
      title: fulfillment.text,
      description: fulfillment.hint,
    })
    return stages
  }

  const stages = [{
    stage: 'ORDER_CREATED',
    title: '创建订单',
    description: '订单已创建',
  }]

  if (fulfillment.code === FULFILLMENT_STATUS.PAYMENT_FAILED) {
    stages.push({ stage: 'PAYMENT_FAILED', title: '支付失败', description: fulfillment.hint })
    return stages
  }

  if (paidAt && fulfillment.code !== FULFILLMENT_STATUS.CREATED && fulfillment.code !== FULFILLMENT_STATUS.AWAITING_PAYMENT) {
    stages.push({
      stage: 'PAID',
      at: paidAt,
      title: '支付成功',
      description: '用户已完成支付',
    })
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

/** 微信物流 action_type 履约优先级（数值越大越代表履约进展越靠后） */
const PATH_ACTION_FULFILLMENT_RANK = {
  400001: 110,
  300003: 100,
  300004: 95,
  300002: 80,
  400002: 70,
  200001: 60,
  100001: 50,
  100003: 45,
  100002: 40,
}

function normalizePathItemList(pathItemList) {
  if (!Array.isArray(pathItemList)) return []
  return pathItemList.filter((item) => item && typeof item === 'object')
}

function pickLatestPathNode(pathItemList) {
  const list = normalizePathItemList(pathItemList)
  if (!list.length) return null
  return list.reduce((latest, item) => {
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

/**
 * 选取用于履约状态的轨迹节点。
 * 顺丰等在签收后可能追加时间更晚的 200001 说明节点，不能仅用 action_time 最大值。
 */
function pickFulfillmentPathNode(pathItemList) {
  const list = normalizePathItemList(pathItemList)
  if (!list.length) return null

  return list.reduce((best, item) => {
    if (!best) return item
    const bestRank = PATH_ACTION_FULFILLMENT_RANK[Number(best.action_type)] || 0
    const itemRank = PATH_ACTION_FULFILLMENT_RANK[Number(item.action_type)] || 0
    if (itemRank > bestRank) return item
    if (itemRank < bestRank) return best

    const bestTs = Number(best.action_time) || 0
    const itemTs = Number(item.action_time) || 0
    if (itemTs > bestTs) return item
    if (itemTs < bestTs) return best

    const bestType = Number(best.action_type) || 0
    const itemType = Number(item.action_type) || 0
    return itemType >= bestType ? item : best
  }, null)
}

module.exports = {
  FULFILLMENT_STATUS,
  STATUS_LABELS,
  ACTIVE_REFUND_STATUSES,
  COMPLETED_REFUND_STATUSES,
  hasQrCode,
  isDigitalItemFullyDelivered,
  pickEffectiveRefundRow,
  mapRefundRowToStatus,
  mapPathActionToStatus,
  resolveFulfillmentKind,
  resolveOrderFulfillmentStatus,
  buildFulfillmentTimelineStages,
  pickLatestPathNode,
  pickFulfillmentPathNode,
}
