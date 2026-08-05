const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralSchema } = require('../utils/referralSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { roundMoney, parseMoney } = require('./commissionService')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureReferralReconciliationSchema } = require('../utils/referralReconciliationSchema')

const RECENT_SHARE_LIMIT = 8
const MONEY_TOLERANCE = 0.02

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function mapShareEventRow(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    user_nickname: row.user_nickname || null,
    item_type: row.item_type,
    item_id: row.item_id,
    channel: row.channel,
    created_at: row.created_at,
  }
}

async function getReferralOverviewStats() {
  await ensureReferralSchema()
  await ensureCommissionSchema()
  await ensureReferralRewardsSchema()

  const [
    [[{ activeReferrers }]],
    [[{ activeBindings }]],
    [[{ totalShares }]],
    [[{ todayShares }]],
    [commissionRows],
    [withdrawRows],
    [[walletTotals]],
    [recentShares],
  ] = await Promise.all([
    db.query(
      `SELECT COUNT(*) AS activeReferrers
       FROM referral_codes WHERE status = 'active'`
    ),
    db.query(
      `SELECT COUNT(*) AS activeBindings
       FROM referral_bindings
       WHERE expires_at IS NULL OR expires_at > NOW()`
    ),
    db.query('SELECT COUNT(*) AS totalShares FROM share_events'),
    db.query(
      `SELECT COUNT(*) AS totalShares FROM share_events
       WHERE created_at >= CURDATE()`
    ),
    db.query(
      `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(commission_amount), 0) AS amount
       FROM commission_ledger
       GROUP BY status`
    ),
    db.query(
      `SELECT status, COUNT(*) AS cnt, COALESCE(SUM(amount), 0) AS amount
       FROM withdrawal_requests
       GROUP BY status`
    ),
    db.query(
      `SELECT
         COALESCE(SUM(pending_balance), 0) AS pending_total,
         COALESCE(SUM(available_balance), 0) AS available_total,
         COALESCE(SUM(total_earned), 0) AS earned_total,
         COALESCE(SUM(total_withdrawn), 0) AS withdrawn_total
       FROM user_wallets`
    ),
    db.query(
      `SELECT se.id, se.user_id, se.item_type, se.item_id, se.channel, se.created_at,
              wu.nickname AS user_nickname
       FROM share_events se
       LEFT JOIN wx_users wu ON wu.id = se.user_id
       ORDER BY se.id DESC
       LIMIT ?`,
      [RECENT_SHARE_LIMIT]
    ),
  ])

  const commissionsByStatus = {}
  for (const row of commissionRows || []) {
    commissionsByStatus[row.status] = {
      count: Number(row.cnt || 0),
      amount_yuan: roundMoney(row.amount),
    }
  }

  const withdrawalsByStatus = {}
  for (const row of withdrawRows || []) {
    withdrawalsByStatus[row.status] = {
      count: Number(row.cnt || 0),
      amount_yuan: roundMoney(row.amount),
    }
  }

  return {
    active_referrers: Number(activeReferrers) || 0,
    active_bindings: Number(activeBindings) || 0,
    total_shares: Number(totalShares) || 0,
    today_shares: Number(todayShares) || 0,
    commissions_by_status: commissionsByStatus,
    withdrawals_by_status: withdrawalsByStatus,
    wallet_totals: {
      pending_yuan: roundMoney(walletTotals?.pending_total),
      available_yuan: roundMoney(walletTotals?.available_total),
      earned_yuan: roundMoney(walletTotals?.earned_total),
      withdrawn_yuan: roundMoney(walletTotals?.withdrawn_total),
    },
    recent_share_events: (recentShares || []).map(mapShareEventRow),
  }
}

async function listAdminShareEvents({
  page = 1,
  pageSize = 20,
  userId,
  itemType,
  channel,
  dateFrom,
  dateTo,
} = {}) {
  await ensureReferralSchema()

  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit
  const params = []
  const filters = []

  if (userId) {
    filters.push('se.user_id = ?')
    params.push(userId)
  }
  if (itemType) {
    filters.push('se.item_type = ?')
    params.push(itemType)
  }
  if (channel) {
    filters.push('se.channel = ?')
    params.push(channel)
  }
  if (dateFrom) {
    filters.push('se.created_at >= ?')
    params.push(dateFrom)
  }
  if (dateTo) {
    filters.push('se.created_at <= ?')
    params.push(dateTo)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const [rows] = await db.query(
    `SELECT se.id, se.user_id, se.item_type, se.item_id, se.channel, se.created_at,
            wu.nickname AS user_nickname
     FROM share_events se
     LEFT JOIN wx_users wu ON wu.id = se.user_id
     ${where}
     ORDER BY se.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM share_events se ${where}`,
    params
  )

  return {
    items: (rows || []).map(mapShareEventRow),
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
  }
}

async function detectWalletPendingMismatches() {
  const [rows] = await db.query(
    `SELECT t.user_id, t.wallet_pending, t.ledger_pending
     FROM (
       SELECT uw.user_id,
              uw.pending_balance AS wallet_pending,
              COALESCE(SUM(CASE WHEN cl.status = 'pending' THEN cl.commission_amount ELSE 0 END), 0) AS ledger_pending
       FROM user_wallets uw
       LEFT JOIN commission_ledger cl ON cl.user_id = uw.user_id
       GROUP BY uw.user_id, uw.pending_balance
     ) t
     WHERE ABS(t.wallet_pending - t.ledger_pending) > ?
     ORDER BY ABS(t.wallet_pending - t.ledger_pending) DESC
     LIMIT 50`,
    [MONEY_TOLERANCE]
  )

  return (rows || []).map((row) => ({
    type: 'wallet_pending_mismatch',
    user_id: row.user_id,
    wallet_pending_yuan: roundMoney(row.wallet_pending),
    ledger_pending_yuan: roundMoney(row.ledger_pending),
    diff_yuan: roundMoney(parseMoney(row.wallet_pending) - parseMoney(row.ledger_pending)),
  }))
}

async function detectOrdersMissingCommission() {
  // 降噪：排除自荐、无计佣明细、以及系统未配置任何有效费率规则的订单
  const [rows] = await db.query(
    `SELECT o.id AS order_id, o.out_trade_no, o.referrer_id, o.success_time
     FROM orders o
     INNER JOIN order_items oi
       ON oi.order_id = o.id
      AND oi.type IN ('right', 'artwork', 'digital')
      AND oi.price > 0
     LEFT JOIN commission_ledger cl ON cl.order_id = o.id
     WHERE o.trade_state = 'SUCCESS'
       AND o.referrer_id IS NOT NULL
       AND o.referrer_id <> o.user_id
       AND EXISTS (
         SELECT 1 FROM commission_rate_rules r
         WHERE r.is_active = 1
           AND r.product_type = oi.type
       )
     GROUP BY o.id, o.out_trade_no, o.referrer_id, o.success_time
     HAVING COUNT(cl.id) = 0
     ORDER BY o.success_time DESC
     LIMIT 50`
  )

  return (rows || []).map((row) => ({
    type: 'order_missing_commission',
    order_id: row.order_id,
    out_trade_no: row.out_trade_no,
    referrer_id: row.referrer_id,
    success_time: row.success_time,
  }))
}

async function detectWithdrawnTotalMismatches() {
  const [rows] = await db.query(
    `SELECT t.user_id, t.wallet_withdrawn, t.ledger_withdrawn
     FROM (
       SELECT uw.user_id,
              uw.total_withdrawn AS wallet_withdrawn,
              COALESCE(SUM(CASE WHEN wr.status = 'success' THEN wr.amount ELSE 0 END), 0) AS ledger_withdrawn
       FROM user_wallets uw
       LEFT JOIN withdrawal_requests wr ON wr.user_id = uw.user_id
       GROUP BY uw.user_id, uw.total_withdrawn
     ) t
     WHERE ABS(t.wallet_withdrawn - t.ledger_withdrawn) > ?
     ORDER BY ABS(t.wallet_withdrawn - t.ledger_withdrawn) DESC
     LIMIT 50`,
    [MONEY_TOLERANCE]
  )

  return (rows || []).map((row) => ({
    type: 'wallet_withdrawn_mismatch',
    user_id: row.user_id,
    wallet_withdrawn_yuan: roundMoney(row.wallet_withdrawn),
    success_withdrawn_yuan: roundMoney(row.ledger_withdrawn),
    diff_yuan: roundMoney(parseMoney(row.wallet_withdrawn) - parseMoney(row.ledger_withdrawn)),
  }))
}

async function detectWalletAvailableMismatches() {
  // 只告警「钱包多于账本」：少算可能来自欠款冲抵（不改 ledger），属预期噪音
  const [rows] = await db.query(
    `SELECT t.user_id, t.wallet_available, t.debt_balance, t.expected_available
     FROM (
       SELECT uw.user_id,
              uw.available_balance AS wallet_available,
              uw.debt_balance AS debt_balance,
              COALESCE(cl.settlable_sum, 0) + COALESCE(bg.bonus_sum, 0) AS expected_available
       FROM user_wallets uw
       LEFT JOIN (
         SELECT user_id, SUM(commission_amount) AS settlable_sum
         FROM commission_ledger
         WHERE status = 'settlable'
         GROUP BY user_id
       ) cl ON cl.user_id = uw.user_id
       LEFT JOIN (
         SELECT user_id, SUM(amount) AS bonus_sum
         FROM referral_bonus_grants
         WHERE status = 'settlable'
         GROUP BY user_id
       ) bg ON bg.user_id = uw.user_id
     ) t
     WHERE (t.wallet_available - t.expected_available) > ?
     ORDER BY (t.wallet_available - t.expected_available) DESC
     LIMIT 50`,
    [MONEY_TOLERANCE]
  )

  return (rows || []).map((row) => ({
    type: 'wallet_available_overage',
    user_id: row.user_id,
    wallet_available_yuan: roundMoney(row.wallet_available),
    debt_balance_yuan: roundMoney(row.debt_balance),
    expected_available_yuan: roundMoney(row.expected_available),
    overage_yuan: roundMoney(parseMoney(row.wallet_available) - parseMoney(row.expected_available)),
  }))
}

async function detectReferralBindingCycles() {
  const [rows] = await db.query(
    `SELECT id, referrer_id, referee_id
     FROM referral_bindings
     ORDER BY id ASC
     LIMIT 5000`
  )
  const byReferee = new Map()
  for (const row of rows || []) {
    byReferee.set(Number(row.referee_id), Number(row.referrer_id))
  }

  const issues = []
  const seenComponent = new Set()
  for (const refereeId of byReferee.keys()) {
    if (seenComponent.has(refereeId)) continue
    const path = []
    const indexOf = new Map()
    let current = refereeId
    for (let depth = 0; depth < 64; depth += 1) {
      if (!current || !byReferee.has(current)) break
      if (indexOf.has(current)) {
        const cycleStart = indexOf.get(current)
        const cycle = path.slice(cycleStart)
        cycle.push(current)
        for (const id of path) seenComponent.add(id)
        issues.push({
          type: 'referral_binding_cycle',
          cycle_user_ids: cycle,
        })
        break
      }
      indexOf.set(current, path.length)
      path.push(current)
      current = byReferee.get(current)
    }
    if (issues.length >= 50) break
  }
  return issues
}

async function runReferralReconciliation() {
  await ensureReferralReconciliationSchema()
  await ensureReferralSchema()
  await ensureCommissionSchema()
  await ensureReferralRewardsSchema()

  const [
    pendingIssues,
    missingCommissionIssues,
    withdrawnIssues,
    availableIssues,
    cycleIssues,
  ] = await Promise.all([
    detectWalletPendingMismatches(),
    detectOrdersMissingCommission(),
    detectWithdrawnTotalMismatches(),
    detectWalletAvailableMismatches(),
    detectReferralBindingCycles(),
  ])

  const issues = [
    ...pendingIssues,
    ...missingCommissionIssues,
    ...withdrawnIssues,
    ...availableIssues,
    ...cycleIssues,
  ]

  const overview = await getReferralOverviewStats()
  const stats = {
    checked_at: new Date().toISOString(),
    active_referrers: overview.active_referrers,
    active_bindings: overview.active_bindings,
    total_shares: overview.total_shares,
    wallet_totals: overview.wallet_totals,
    commission_status_counts: Object.fromEntries(
      Object.entries(overview.commissions_by_status).map(([k, v]) => [k, v.count])
    ),
  }

  const issueCount = issues.length
  const status = issueCount === 0 ? 'ok' : 'issues'
  const issuesPayload = issues.slice(0, 100)

  const [insertResult] = await db.query(
    `INSERT INTO referral_reconciliation_logs
     (status, issue_count, stats_json, issues_json)
     VALUES (?, ?, ?, ?)`,
    [status, issueCount, JSON.stringify(stats), JSON.stringify(issuesPayload)]
  )

  if (issueCount > 0) {
    logger.warn('referral reconciliation found issues', { issueCount, logId: insertResult.insertId })
  } else {
    logger.info('referral reconciliation ok', { logId: insertResult.insertId })
  }

  return {
    ok: issueCount === 0,
    log_id: insertResult.insertId,
    issue_count: issueCount,
    issues: issuesPayload,
    stats,
  }
}

async function listReconciliationLogs({ page = 1, pageSize = 20 } = {}) {
  await ensureReferralReconciliationSchema()

  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit

  const [rows] = await db.query(
    `SELECT id, status, issue_count, stats_json, issues_json, created_at
     FROM referral_reconciliation_logs
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  )

  const [countRows] = await db.query(
    'SELECT COUNT(*) AS total FROM referral_reconciliation_logs'
  )

  const items = (rows || []).map((row) => ({
    id: row.id,
    status: row.status,
    issue_count: Number(row.issue_count || 0),
    stats: typeof row.stats_json === 'string' ? JSON.parse(row.stats_json) : row.stats_json,
    issues: typeof row.issues_json === 'string' ? JSON.parse(row.issues_json) : row.issues_json,
    created_at: row.created_at,
  }))

  return {
    items,
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
  }
}

async function getReconciliationLogById(logId) {
  await ensureReferralReconciliationSchema()

  const id = parseInt(logId, 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的记录 ID' })
  }

  const [rows] = await db.query(
    `SELECT id, status, issue_count, stats_json, issues_json, created_at
     FROM referral_reconciliation_logs WHERE id = ? LIMIT 1`,
    [id]
  )

  if (!rows.length) {
    return adminResult(404, { error: '对账记录不存在' })
  }

  const row = rows[0]
  return adminResult(200, {
    id: row.id,
    status: row.status,
    issue_count: Number(row.issue_count || 0),
    stats: typeof row.stats_json === 'string' ? JSON.parse(row.stats_json) : row.stats_json,
    issues: typeof row.issues_json === 'string' ? JSON.parse(row.issues_json) : row.issues_json,
    created_at: row.created_at,
  })
}

module.exports = {
  getReferralOverviewStats,
  listAdminShareEvents,
  runReferralReconciliation,
  listReconciliationLogs,
  getReconciliationLogById,
  detectWalletPendingMismatches,
  detectOrdersMissingCommission,
  detectWithdrawnTotalMismatches,
}
