const db = require('../db')
const logger = require('../utils/logger')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { ensureReferralSchema } = require('../utils/referralSchema')
const { USER_TIERS, getUserTierProfile } = require('./userTierService')
const {
  resolveOrderFulfillmentStatus,
  FULFILLMENT_STATUS,
} = require('../utils/orderFulfillmentStatus')

const COMMISSION_CAP_YUAN = parseFloat(process.env.COMMISSION_CAP_YUAN || '5000')
const VIP_BONUS_RATE = parseFloat(process.env.VIP_COMMISSION_BONUS_RATE || '0.02')
const ACTIVE_REFUND_STATUSES = ['PENDING', 'APPROVED', 'PROCESSING', 'SUCCESS']

const DEFAULT_RATE_RULES = [
  { product_type: 'right', min_price: 0, max_price: 298.99, base_rate: 0.1, settlement_days: 7 },
  { product_type: 'right', min_price: 299, max_price: 698.99, base_rate: 0.1, settlement_days: 7 },
  { product_type: 'right', min_price: 699, max_price: 998.99, base_rate: 0.1, settlement_days: 7 },
  { product_type: 'right', min_price: 999, max_price: 1998.99, base_rate: 0.12, settlement_days: 7 },
  { product_type: 'right', min_price: 1999, max_price: 4998.99, base_rate: 0.12, settlement_days: 7 },
  { product_type: 'right', min_price: 4999, max_price: null, base_rate: 0.15, settlement_days: 7 },
  { product_type: 'artwork', min_price: 0, max_price: 4999.99, base_rate: 0.05, settlement_days: 15 },
  { product_type: 'artwork', min_price: 5000, max_price: 19999.99, base_rate: 0.08, settlement_days: 15 },
  { product_type: 'artwork', min_price: 20000, max_price: null, base_rate: 0.1, settlement_days: 15 },
  { product_type: 'digital', min_price: 0, max_price: 98.99, base_rate: 0.15, settlement_days: 7 },
  { product_type: 'digital', min_price: 99, max_price: 198.99, base_rate: 0.15, settlement_days: 7 },
  { product_type: 'digital', min_price: 199, max_price: 298.99, base_rate: 0.15, settlement_days: 7 },
  { product_type: 'digital', min_price: 299, max_price: 598.99, base_rate: 0.18, settlement_days: 7 },
  { product_type: 'digital', min_price: 599, max_price: 998.99, base_rate: 0.2, settlement_days: 7 },
  { product_type: 'digital', min_price: 999, max_price: null, base_rate: 0.2, settlement_days: 7 },
]

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function parseMoney(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function roundMoney(n) {
  return Math.round(n * 100) / 100
}

function matchRateRule(rules, priceYuan) {
  const price = parseMoney(priceYuan)
  const sorted = [...(rules || [])]
    .filter((rule) => rule.is_active !== 0 && rule.is_active !== false)
    .sort((a, b) => parseMoney(b.min_price) - parseMoney(a.min_price))

  for (const rule of sorted) {
    const min = parseMoney(rule.min_price)
    const max = rule.max_price == null ? null : parseMoney(rule.max_price)
    if (price < min) continue
    if (max != null && price > max) continue
    return rule
  }
  return null
}

function calculateCommissionAmount({
  lineAmountYuan,
  baseRate,
  bonusRate = 0,
  capYuan = COMMISSION_CAP_YUAN,
}) {
  const amount = parseMoney(lineAmountYuan)
  const base = parseMoney(baseRate)
  const bonus = parseMoney(bonusRate)
  if (amount <= 0 || base < 0) return 0

  const finalRate = base + bonus
  const raw = amount * finalRate
  const capped = Math.min(raw, capYuan)
  return roundMoney(capped)
}

function resolveCommissionRates({ tier, advisorRate, matchedRule }) {
  if (!matchedRule) return null

  if (tier === USER_TIERS.ART_ADVISOR && advisorRate != null && advisorRate > 0) {
    return {
      base_rate: advisorRate,
      bonus_rate: 0,
      final_rate: advisorRate,
      settlement_days: matchedRule.settlement_days,
    }
  }

  const baseRate = parseMoney(matchedRule.base_rate)
  const bonusRate = tier === USER_TIERS.VIP_COLLECTOR ? VIP_BONUS_RATE : 0
  return {
    base_rate: baseRate,
    bonus_rate: bonusRate,
    final_rate: baseRate + bonusRate,
    settlement_days: matchedRule.settlement_days,
  }
}

async function seedDefaultRateRulesIfEmpty(connection = db) {
  const [rows] = await connection.query('SELECT COUNT(*) AS cnt FROM commission_rate_rules')
  if (Number(rows[0]?.cnt || 0) > 0) return

  for (const rule of DEFAULT_RATE_RULES) {
    await connection.query(
      `INSERT INTO commission_rate_rules
       (product_type, min_price, max_price, base_rate, settlement_days, is_active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [rule.product_type, rule.min_price, rule.max_price, rule.base_rate, rule.settlement_days]
    )
  }
  logger.info('commission_rate_rules seeded with defaults')
}

async function listActiveRateRules(productType, connection = db) {
  const params = []
  let sql = `SELECT id, product_type, min_price, max_price, base_rate, settlement_days, is_active
             FROM commission_rate_rules WHERE is_active = 1`
  if (productType) {
    sql += ' AND product_type = ?'
    params.push(productType)
  }
  sql += ' ORDER BY product_type ASC, min_price ASC'
  const [rows] = await connection.query(sql, params)
  return rows || []
}

async function getArtAdvisorRate(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT commission_rate FROM art_advisor_applications
     WHERE user_id = ? AND status = 'approved' AND commission_rate IS NOT NULL
     ORDER BY reviewed_at DESC, id DESC LIMIT 1`,
    [userId]
  )
  if (!rows.length) return null
  return parseMoney(rows[0].commission_rate)
}

async function ensureWallet(userId, connection = db) {
  await connection.query(
    'INSERT IGNORE INTO user_wallets (user_id) VALUES (?)',
    [userId]
  )
}

async function adjustWalletBalances(userId, { pendingDelta = 0, availableDelta = 0, earnedDelta = 0 }, connection = db) {
  await ensureWallet(userId, connection)
  await connection.query(
    `UPDATE user_wallets
     SET pending_balance = GREATEST(pending_balance + ?, 0),
         available_balance = GREATEST(available_balance + ?, 0),
         total_earned = GREATEST(total_earned + ?, 0),
         updated_at = NOW()
     WHERE user_id = ?`,
    [pendingDelta, availableDelta, earnedDelta, userId]
  )
}

async function getWalletSummary(userId, connection = db) {
  await ensureCommissionSchema()
  await ensureWallet(userId, connection)
  const [rows] = await connection.query(
    'SELECT pending_balance, available_balance, total_earned, total_withdrawn FROM user_wallets WHERE user_id = ? LIMIT 1',
    [userId]
  )
  const wallet = rows[0] || {
    pending_balance: 0,
    available_balance: 0,
    total_earned: 0,
    total_withdrawn: 0,
  }
  return {
    pending_commission_yuan: roundMoney(wallet.pending_balance),
    available_commission_yuan: roundMoney(wallet.available_balance),
    withdrawn_commission_yuan: roundMoney(wallet.total_withdrawn),
    total_earned_yuan: roundMoney(wallet.total_earned),
  }
}

async function loadOrderSettlementContext(orderId, connection = db) {
  const map = await loadOrderSettlementContextsByOrderIds([orderId], connection)
  return map.get(Number(orderId)) || null
}

async function loadOrderSettlementContextsByOrderIds(orderIds, connection = db) {
  const uniqueIds = [...new Set((orderIds || []).map((id) => Number(id)).filter((id) => id > 0))]
  const contextByOrderId = new Map()
  if (!uniqueIds.length) return contextByOrderId

  const [orders] = await connection.query(
    `SELECT id, user_id, referrer_id, trade_state, success_time, out_trade_no
     FROM orders WHERE id IN (?)`,
    [uniqueIds]
  )

  const [items] = await connection.query(
    `SELECT id, order_id, type, quantity, price, delivery_qr_code_url, delivery_qr_code_at
     FROM order_items WHERE order_id IN (?)`,
    [uniqueIds]
  )

  const [shipments] = await connection.query(
    `SELECT order_id, id, waybill_id, status, latest_path_action_type, latest_path_action_at, created_at
     FROM order_shipments
     WHERE order_id IN (?) AND status != 'cancelled'
     ORDER BY order_id ASC, id DESC`,
    [uniqueIds]
  )

  const outTradeNos = [...new Set((orders || []).map((order) => order.out_trade_no).filter(Boolean))]
  let refunds = []
  if (outTradeNos.length) {
    ;[refunds] = await connection.query(
      `SELECT out_trade_no, status, id
       FROM refund_requests
       WHERE out_trade_no IN (?) AND status IN (?)
       ORDER BY id DESC`,
      [outTradeNos, ACTIVE_REFUND_STATUSES]
    )
  }

  const itemsByOrderId = new Map()
  for (const item of items || []) {
    const bucket = itemsByOrderId.get(item.order_id) || []
    bucket.push(item)
    itemsByOrderId.set(item.order_id, bucket)
  }

  const shipmentByOrderId = new Map()
  for (const shipment of shipments || []) {
    if (!shipmentByOrderId.has(shipment.order_id)) {
      shipmentByOrderId.set(shipment.order_id, shipment)
    }
  }

  const refundByOutTradeNo = new Map()
  for (const refund of refunds || []) {
    if (!refundByOutTradeNo.has(refund.out_trade_no)) {
      refundByOutTradeNo.set(refund.out_trade_no, refund)
    }
  }

  for (const order of orders || []) {
    contextByOrderId.set(Number(order.id), {
      order,
      items: itemsByOrderId.get(order.id) || [],
      shipment: shipmentByOrderId.get(order.id) || null,
      refundStatus: refundByOutTradeNo.get(order.out_trade_no) || null,
    })
  }

  return contextByOrderId
}

function resolveItemFulfillmentCode(item, ctx) {
  const fulfillment = resolveOrderFulfillmentStatus({
    tradeState: ctx.order.trade_state,
    items: [{
      type: item.type,
      delivery_qr_code_url: item.delivery_qr_code_url,
      delivery_qr_code_at: item.delivery_qr_code_at,
    }],
    shipment: ctx.shipment
      ? {
        waybill_id: ctx.shipment.waybill_id,
        status: ctx.shipment.status,
        latest_path_action_type: ctx.shipment.latest_path_action_type,
        created_at: ctx.shipment.created_at,
      }
      : null,
    refundStatus: ctx.refundStatus,
  })
  return fulfillment?.code || null
}

function resolveSettlementAnchorAt(item, ctx) {
  const code = resolveItemFulfillmentCode(item, ctx)
  if (!code) return null

  if (item.type === 'digital') {
    if (code !== FULFILLMENT_STATUS.DELIVERED && code !== FULFILLMENT_STATUS.COMPLETED) return null
    return item.delivery_qr_code_at || ctx.order.success_time || null
  }

  if (item.type === 'right' || item.type === 'artwork') {
    if (code !== FULFILLMENT_STATUS.RECEIVED && code !== FULFILLMENT_STATUS.COMPLETED) return null
    if (ctx.shipment && Number(ctx.shipment.latest_path_action_type) === 300003) {
      return ctx.shipment.latest_path_action_at || null
    }
    return ctx.order.success_time || null
  }

  return null
}

function isSettlementPeriodMet(anchorAt, settlementDays) {
  if (!anchorAt) return false
  const anchor = new Date(anchorAt)
  if (Number.isNaN(anchor.getTime())) return false
  const days = parseInt(settlementDays, 10) || 0
  const due = anchor.getTime() + days * 24 * 60 * 60 * 1000
  return Date.now() >= due
}

async function isCommissionSettleEligible(ledgerRow, connection = db, contextByOrderId = null) {
  if (!ledgerRow || ledgerRow.status !== 'pending') return false
  if (ledgerRow.trade_state === 'REFUND' || ledgerRow.order?.trade_state === 'REFUND') return false

  const ctx = contextByOrderId?.get(Number(ledgerRow.order_id))
    ?? await loadOrderSettlementContext(ledgerRow.order_id, connection)
  if (!ctx || ctx.order.trade_state !== 'SUCCESS') return false
  if (ctx.refundStatus) return false

  const item = (ctx.items || []).find((row) => Number(row.id) === Number(ledgerRow.order_item_id))
  if (!item) return false

  const anchorAt = resolveSettlementAnchorAt(item, ctx)
  return isSettlementPeriodMet(anchorAt, ledgerRow.settlement_days)
}

async function createCommissionsForPaidOrder({ orderId, connection = db }) {
  await ensureReferralSchema()
  await ensureCommissionSchema()
  await seedDefaultRateRulesIfEmpty(connection)

  const [orders] = await connection.query(
    `SELECT id, user_id, referrer_id, trade_state FROM orders WHERE id = ? LIMIT 1`,
    [orderId]
  )
  const order = orders[0]
  if (!order || order.trade_state !== 'SUCCESS' || !order.referrer_id) {
    return { created: 0 }
  }
  if (Number(order.referrer_id) === Number(order.user_id)) {
    return { created: 0 }
  }

  const referrerId = Number(order.referrer_id)
  const refereeId = Number(order.user_id)
  const tierProfile = await getUserTierProfile(referrerId, connection)
  const advisorRate = await getArtAdvisorRate(referrerId, connection)

  const [items] = await connection.query(
    'SELECT id, type, quantity, price FROM order_items WHERE order_id = ?',
    [orderId]
  )

  let created = 0
  for (const item of items || []) {
    if (!['right', 'artwork', 'digital'].includes(item.type)) continue

    const quantity = parseInt(item.quantity, 10) || 1
    const lineAmount = roundMoney(parseMoney(item.price) * quantity)
    if (lineAmount <= 0) continue

    const rules = await listActiveRateRules(item.type, connection)
    const matchedRule = matchRateRule(rules, lineAmount)
    if (!matchedRule) continue

    const rateInfo = resolveCommissionRates({
      tier: tierProfile?.tier,
      advisorRate,
      matchedRule,
    })
    if (!rateInfo) continue

    const commissionAmount = calculateCommissionAmount({
      lineAmountYuan: lineAmount,
      baseRate: rateInfo.base_rate,
      bonusRate: rateInfo.bonus_rate,
    })
    if (commissionAmount <= 0) continue

    const [insertResult] = await connection.query(
      `INSERT IGNORE INTO commission_ledger
       (user_id, order_id, order_item_id, referee_id, product_type, order_amount,
        base_rate, bonus_rate, final_rate, commission_amount, settlement_days, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        referrerId,
        orderId,
        item.id,
        refereeId,
        item.type,
        lineAmount,
        rateInfo.base_rate,
        rateInfo.bonus_rate,
        rateInfo.final_rate,
        commissionAmount,
        rateInfo.settlement_days,
      ]
    )

    if (!insertResult || insertResult.affectedRows !== 1) continue

    await adjustWalletBalances(referrerId, {
      pendingDelta: commissionAmount,
      earnedDelta: commissionAmount,
    }, connection)
    created += 1
  }

  if (created > 0) {
    logger.info('commission ledger created', { orderId, referrerId, created })
  }

  return { created }
}

async function cancelCommissionsByOrderId(orderId, connection = db) {
  await ensureCommissionSchema()

  const [rows] = await connection.query(
    `SELECT id, user_id, commission_amount, status
     FROM commission_ledger
     WHERE order_id = ? AND status IN ('pending', 'settlable')`,
    [orderId]
  )

  if (!rows.length) return { cancelled: 0 }

  let cancelled = 0
  for (const row of rows) {
    const amount = parseMoney(row.commission_amount)
    if (row.status === 'pending') {
      await adjustWalletBalances(row.user_id, { pendingDelta: -amount, earnedDelta: -amount }, connection)
    } else if (row.status === 'settlable') {
      await adjustWalletBalances(row.user_id, { availableDelta: -amount, earnedDelta: -amount }, connection)
    }

    await connection.query(
      `UPDATE commission_ledger SET status = 'cancelled', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    cancelled += 1
  }

  if (cancelled > 0) {
    logger.info('commission ledger cancelled', { orderId, cancelled })
  }

  return { cancelled }
}

async function settlePendingCommissions({ limit = 50 } = {}) {
  await ensureCommissionSchema()

  const [rows] = await db.query(
    `SELECT cl.id, cl.user_id, cl.order_id, cl.order_item_id, cl.commission_amount,
            cl.settlement_days, cl.status, o.trade_state
     FROM commission_ledger cl
     INNER JOIN orders o ON o.id = cl.order_id
     WHERE cl.status = 'pending' AND o.trade_state = 'SUCCESS'
     ORDER BY cl.id ASC
     LIMIT ?`,
    [Math.max(1, Math.min(limit, 200))]
  )

  let settled = 0
  const contextByOrderId = await loadOrderSettlementContextsByOrderIds(
    (rows || []).map((row) => row.order_id)
  )

  for (const row of rows || []) {
    const eligible = await isCommissionSettleEligible(row, db, contextByOrderId)
    if (!eligible) continue

    const connection = await db.getConnection()
    try {
      await connection.beginTransaction()

      const [locked] = await connection.query(
        `SELECT id, user_id, commission_amount, status
         FROM commission_ledger WHERE id = ? FOR UPDATE`,
        [row.id]
      )
      if (!locked.length || locked[0].status !== 'pending') {
        await connection.rollback()
        continue
      }

      const amount = parseMoney(locked[0].commission_amount)
      await connection.query(
        `UPDATE commission_ledger
         SET status = 'settlable', settle_at = NOW(), updated_at = NOW()
         WHERE id = ?`,
        [row.id]
      )
      await adjustWalletBalances(locked[0].user_id, {
        pendingDelta: -amount,
        availableDelta: amount,
      }, connection)

      await connection.commit()
      settled += 1
    } catch (err) {
      await connection.rollback()
      logger.warn('commission settle failed', { ledgerId: row.id, err: err.message })
    } finally {
      connection.release()
    }
  }

  return { settled, scanned: (rows || []).length }
}

async function listUserCommissions(userId, { page = 1, pageSize = 20, status } = {}) {
  await ensureCommissionSchema()
  const offset = (Math.max(1, page) - 1) * Math.max(1, Math.min(pageSize, 100))
  const limit = Math.max(1, Math.min(pageSize, 100))
  const params = [userId]
  let where = 'WHERE cl.user_id = ?'
  if (status) {
    where += ' AND cl.status = ?'
    params.push(status)
  }
  params.push(limit, offset)

  const [rows] = await db.query(
    `SELECT cl.id, cl.order_id, cl.order_item_id, cl.referee_id, cl.product_type,
            cl.order_amount, cl.final_rate, cl.commission_amount, cl.status,
            cl.settle_at, cl.created_at, o.out_trade_no
     FROM commission_ledger cl
     LEFT JOIN orders o ON o.id = cl.order_id
     ${where}
     ORDER BY cl.id DESC
     LIMIT ? OFFSET ?`,
    params
  )

  const countParams = [userId]
  let countWhere = 'WHERE cl.user_id = ?'
  if (status) {
    countWhere += ' AND cl.status = ?'
    countParams.push(status)
  }

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM commission_ledger cl ${countWhere}`,
    countParams
  )

  return {
    items: rows || [],
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
  }
}

async function listAdminCommissions({
  page = 1,
  pageSize = 20,
  status,
  userId,
  outTradeNo,
} = {}) {
  await ensureCommissionSchema()
  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit
  const params = []
  const filters = []

  if (status) {
    filters.push('cl.status = ?')
    params.push(status)
  }
  if (userId) {
    filters.push('cl.user_id = ?')
    params.push(userId)
  }
  if (outTradeNo) {
    filters.push('o.out_trade_no LIKE ?')
    params.push(`%${String(outTradeNo).trim()}%`)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const [rows] = await db.query(
    `SELECT cl.*, o.out_trade_no, wu.nickname AS referrer_nickname, ru.nickname AS referee_nickname
     FROM commission_ledger cl
     LEFT JOIN orders o ON o.id = cl.order_id
     LEFT JOIN wx_users wu ON wu.id = cl.user_id
     LEFT JOIN wx_users ru ON ru.id = cl.referee_id
     ${where}
     ORDER BY cl.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total
     FROM commission_ledger cl
     LEFT JOIN orders o ON o.id = cl.order_id
     ${where}`,
    params
  )

  return {
    items: rows || [],
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
  }
}

async function listAdminCommissionRules() {
  await ensureCommissionSchema()
  await seedDefaultRateRulesIfEmpty()
  const [rows] = await db.query(
    `SELECT id, product_type, min_price, max_price, base_rate, settlement_days, is_active, updated_at
     FROM commission_rate_rules
     ORDER BY product_type ASC, min_price ASC`
  )
  return rows || []
}

async function updateAdminCommissionRule(ruleId, body) {
  await ensureCommissionSchema()
  const id = parseInt(ruleId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的规则ID' })
  }

  const baseRate = body?.base_rate != null ? parseMoney(body.base_rate) : null
  const settlementDays = body?.settlement_days != null ? parseInt(body.settlement_days, 10) : null
  const isActive = body?.is_active

  const fields = []
  const params = []

  if (baseRate != null) {
    if (baseRate <= 0 || baseRate > 1) return adminResult(400, { error: '佣金比例无效' })
    fields.push('base_rate = ?')
    params.push(baseRate)
  }
  if (settlementDays != null) {
    if (settlementDays < 0 || settlementDays > 90) return adminResult(400, { error: '结算天数无效' })
    fields.push('settlement_days = ?')
    params.push(settlementDays)
  }
  if (isActive === true || isActive === false || isActive === 0 || isActive === 1) {
    fields.push('is_active = ?')
    params.push(isActive ? 1 : 0)
  }

  if (!fields.length) return adminResult(400, { error: '没有可更新字段' })

  params.push(id)
  const [result] = await db.query(
    `UPDATE commission_rate_rules SET ${fields.join(', ')}, updated_at = NOW() WHERE id = ?`,
    params
  )
  if (!result.affectedRows) return adminResult(404, { error: '规则不存在' })
  return adminResult(200, { success: true })
}

module.exports = {
  adminResult,
  COMMISSION_CAP_YUAN,
  VIP_BONUS_RATE,
  parseMoney,
  roundMoney,
  matchRateRule,
  calculateCommissionAmount,
  resolveCommissionRates,
  seedDefaultRateRulesIfEmpty,
  createCommissionsForPaidOrder,
  cancelCommissionsByOrderId,
  settlePendingCommissions,
  getWalletSummary,
  ensureWallet,
  adjustWalletBalances,
  listUserCommissions,
  listAdminCommissions,
  listAdminCommissionRules,
  updateAdminCommissionRule,
  isCommissionSettleEligible,
  resolveSettlementAnchorAt,
}
