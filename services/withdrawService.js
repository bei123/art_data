const crypto = require('crypto')
const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { ensureWallet, adjustWalletBalances, roundMoney, parseMoney } = require('./commissionService')
const { createTransferToWallet, isTransferConfigured } = require('./wechatTransferService')

const MIN_WITHDRAW_YUAN = parseFloat(process.env.MIN_WITHDRAW_YUAN || '0')
const MAX_WITHDRAW_YUAN = parseFloat(process.env.MAX_WITHDRAW_YUAN || '20000')
const DAILY_WITHDRAW_LIMIT_YUAN = parseFloat(process.env.DAILY_WITHDRAW_LIMIT_YUAN || '50000')

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function generateOutBillNo(userId) {
  const rand = crypto.randomBytes(4).toString('hex')
  return `WD${Date.now()}${userId}${rand}`.slice(0, 32)
}

async function getUserOpenid(userId, connection = db) {
  const [rows] = await connection.query(
    'SELECT openid FROM wx_users WHERE id = ? LIMIT 1',
    [userId]
  )
  return rows[0]?.openid || null
}

async function sumTodayWithdrawnYuan(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM withdrawal_requests
     WHERE user_id = ?
       AND status IN ('pending', 'processing', 'success')
       AND created_at >= CURDATE()`,
    [userId]
  )
  return parseMoney(rows[0]?.total)
}

async function hasActiveWithdrawal(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id FROM withdrawal_requests
     WHERE user_id = ? AND status IN ('pending', 'processing')
     LIMIT 1`,
    [userId]
  )
  return rows.length > 0
}

async function allocateSettlableForWithdraw(userId, amountYuan, connection) {
  let remaining = parseMoney(amountYuan)
  const allocated = { commissionIds: [], bonusIds: [] }

  const [commissions] = await connection.query(
    `SELECT id, commission_amount FROM commission_ledger
     WHERE user_id = ? AND status = 'settlable'
     ORDER BY id ASC
     FOR UPDATE`,
    [userId]
  )

  for (const row of commissions || []) {
    if (remaining <= 0) break
    const itemAmount = parseMoney(row.commission_amount)
    if (itemAmount <= 0) continue
    if (itemAmount > remaining + 0.0001) continue

    await connection.query(
      `UPDATE commission_ledger SET status = 'withdrawn', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    allocated.commissionIds.push(row.id)
    remaining = roundMoney(remaining - itemAmount)
  }

  const [bonuses] = await connection.query(
    `SELECT id, amount FROM referral_bonus_grants
     WHERE user_id = ? AND status = 'settlable'
     ORDER BY id ASC
     FOR UPDATE`,
    [userId]
  )

  for (const row of bonuses || []) {
    if (remaining <= 0) break
    const itemAmount = parseMoney(row.amount)
    if (itemAmount <= 0) continue
    if (itemAmount > remaining + 0.0001) continue

    await connection.query(
      `UPDATE referral_bonus_grants SET status = 'withdrawn', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    allocated.bonusIds.push(row.id)
    remaining = roundMoney(remaining - itemAmount)
  }

  if (remaining > 0.01) {
    return { ok: false, error: '请提现全部可提现余额' }
  }

  return { ok: true, allocated }
}

async function restoreWithdrawAllocation(userId, amountYuan, connection) {
  let remaining = parseMoney(amountYuan)

  const [commissions] = await connection.query(
    `SELECT id, commission_amount FROM commission_ledger
     WHERE user_id = ? AND status = 'withdrawn'
     ORDER BY id DESC
     FOR UPDATE`,
    [userId]
  )

  for (const row of commissions || []) {
    if (remaining <= 0) break
    const itemAmount = parseMoney(row.commission_amount)
    await connection.query(
      `UPDATE commission_ledger SET status = 'settlable', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    remaining = roundMoney(remaining - itemAmount)
  }

  const [bonuses] = await connection.query(
    `SELECT id, amount FROM referral_bonus_grants
     WHERE user_id = ? AND status = 'withdrawn'
     ORDER BY id DESC
     FOR UPDATE`,
    [userId]
  )

  for (const row of bonuses || []) {
    if (remaining <= 0) break
    const itemAmount = parseMoney(row.amount)
    await connection.query(
      `UPDATE referral_bonus_grants SET status = 'settlable', updated_at = NOW() WHERE id = ?`,
      [row.id]
    )
    remaining = roundMoney(remaining - itemAmount)
  }
}

function validateWithdrawAmount(amountYuan, availableYuan) {
  const amount = roundMoney(amountYuan)
  const available = roundMoney(availableYuan)

  if (amount <= 0) {
    return { ok: false, error: '提现金额须大于 0' }
  }
  if (MIN_WITHDRAW_YUAN > 0 && amount < MIN_WITHDRAW_YUAN) {
    return { ok: false, error: `最低提现金额为 ${MIN_WITHDRAW_YUAN} 元` }
  }
  if (MAX_WITHDRAW_YUAN > 0 && amount > MAX_WITHDRAW_YUAN) {
    return { ok: false, error: `单笔最高提现 ${MAX_WITHDRAW_YUAN} 元` }
  }
  if (amount > available) {
    return { ok: false, error: '可提现余额不足' }
  }

  return { ok: true, amount }
}

async function requestWithdraw(userId, { amountYuan, withdrawAll = false } = {}) {
  await ensureReferralRewardsSchema()
  await ensureCommissionSchema()

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()
    await ensureWallet(userId, connection)

    const [walletRows] = await connection.query(
      'SELECT available_balance FROM user_wallets WHERE user_id = ? FOR UPDATE',
      [userId]
    )
    const available = parseMoney(walletRows[0]?.available_balance)

    const targetAmount = withdrawAll ? available : parseMoney(amountYuan)
    const validation = validateWithdrawAmount(targetAmount, available)
    if (!validation.ok) {
      await connection.rollback()
      return adminResult(400, { error: validation.error })
    }

    if (await hasActiveWithdrawal(userId, connection)) {
      await connection.rollback()
      return adminResult(409, { error: '已有进行中的提现申请' })
    }

    const todayTotal = await sumTodayWithdrawnYuan(userId, connection)
    if (DAILY_WITHDRAW_LIMIT_YUAN > 0 && todayTotal + validation.amount > DAILY_WITHDRAW_LIMIT_YUAN) {
      await connection.rollback()
      return adminResult(400, { error: '已超过今日提现限额' })
    }

    const allocation = await allocateSettlableForWithdraw(userId, validation.amount, connection)
    if (!allocation.ok) {
      await connection.rollback()
      return adminResult(409, { error: allocation.error })
    }

    await adjustWalletBalances(userId, {
      availableDelta: -validation.amount,
      earnedDelta: 0,
    }, connection)

    const outBillNo = generateOutBillNo(userId)
    const [insertResult] = await connection.query(
      `INSERT INTO withdrawal_requests (user_id, amount, status, out_bill_no)
       VALUES (?, ?, 'pending', ?)`,
      [userId, validation.amount, outBillNo]
    )

    await connection.commit()

    const withdrawalId = insertResult.insertId
    const transferResult = await processWithdrawTransfer(withdrawalId)

    return adminResult(200, {
      success: true,
      withdrawal_id: withdrawalId,
      amount_yuan: validation.amount,
      status: transferResult.status || 'pending',
      manual_review: transferResult.manualReview || false,
    })
  } catch (err) {
    await connection.rollback()
    logger.error('requestWithdraw failed', { userId, err: err.message })
    throw err
  } finally {
    connection.release()
  }
}

async function processWithdrawTransfer(withdrawalId) {
  await ensureReferralRewardsSchema()

  const [rows] = await db.query(
    `SELECT id, user_id, amount, status, out_bill_no FROM withdrawal_requests WHERE id = ? LIMIT 1`,
    [withdrawalId]
  )
  const row = rows[0]
  if (!row || !['pending', 'processing'].includes(row.status)) {
    return { ok: false, status: row?.status }
  }

  if (!isTransferConfigured()) {
    return { ok: true, status: 'pending', manualReview: true }
  }

  const openid = await getUserOpenid(row.user_id)
  await db.query(
    `UPDATE withdrawal_requests SET status = 'processing', updated_at = NOW() WHERE id = ?`,
    [withdrawalId]
  )

  const transfer = await createTransferToWallet({
    openid,
    outBillNo: row.out_bill_no,
    amountYuan: row.amount,
  })

  if (!transfer.ok) {
    await failWithdrawal(withdrawalId, transfer.error || '微信转账失败')
    return { ok: false, status: 'failed', error: transfer.error }
  }

  await db.query(
    `UPDATE withdrawal_requests
     SET status = 'success',
         wx_transfer_id = ?,
         wx_state = ?,
         processed_at = NOW(),
         updated_at = NOW()
     WHERE id = ?`,
    [transfer.transferId, transfer.state || 'SUCCESS', withdrawalId]
  )

  await adjustWalletBalances(row.user_id, {
    earnedDelta: 0,
  })

  await db.query(
    `UPDATE user_wallets
     SET total_withdrawn = total_withdrawn + ?, updated_at = NOW()
     WHERE user_id = ?`,
    [row.amount, row.user_id]
  )

  return { ok: true, status: 'success' }
}

async function failWithdrawal(withdrawalId, reason) {
  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const [rows] = await connection.query(
      `SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ? FOR UPDATE`,
      [withdrawalId]
    )
    const row = rows[0]
    if (!row || row.status === 'success' || row.status === 'cancelled') {
      await connection.rollback()
      return
    }

    await connection.query(
      `UPDATE withdrawal_requests
       SET status = 'failed', fail_reason = ?, processed_at = NOW(), updated_at = NOW()
       WHERE id = ?`,
      [String(reason || '提现失败').slice(0, 255), withdrawalId]
    )

    await adjustWalletBalances(row.user_id, {
      availableDelta: parseMoney(row.amount),
    }, connection)
    await restoreWithdrawAllocation(row.user_id, row.amount, connection)

    await connection.commit()
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

async function approveWithdrawalManually(withdrawalId) {
  await ensureReferralRewardsSchema()

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const [rows] = await connection.query(
      `SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ? FOR UPDATE`,
      [withdrawalId]
    )
    const row = rows[0]
    if (!row) {
      await connection.rollback()
      return adminResult(404, { error: '提现记录不存在' })
    }
    if (row.status === 'success') {
      await connection.rollback()
      return adminResult(200, { success: true, alreadyDone: true })
    }
    if (!['pending', 'processing', 'failed'].includes(row.status)) {
      await connection.rollback()
      return adminResult(400, { error: '当前状态不可确认打款' })
    }

    await connection.query(
      `UPDATE withdrawal_requests
       SET status = 'success', processed_at = NOW(), fail_reason = NULL, updated_at = NOW()
       WHERE id = ?`,
      [withdrawalId]
    )

    await connection.query(
      `UPDATE user_wallets
       SET total_withdrawn = total_withdrawn + ?, updated_at = NOW()
       WHERE user_id = ?`,
      [row.amount, row.user_id]
    )

    await connection.commit()
    return adminResult(200, { success: true })
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

async function listUserWithdrawals(userId, { page = 1, pageSize = 20 } = {}) {
  await ensureReferralRewardsSchema()
  const limit = Math.max(1, Math.min(pageSize, 50))
  const offset = (Math.max(1, page) - 1) * limit

  const [rows] = await db.query(
    `SELECT id, amount, status, fail_reason, created_at, processed_at
     FROM withdrawal_requests
     WHERE user_id = ?
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  )

  const [countRows] = await db.query(
    'SELECT COUNT(*) AS total FROM withdrawal_requests WHERE user_id = ?',
    [userId]
  )

  return {
    items: rows || [],
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
    min_withdraw_yuan: MIN_WITHDRAW_YUAN,
    auto_transfer_enabled: isTransferConfigured(),
  }
}

async function listAdminWithdrawals({
  page = 1,
  pageSize = 20,
  status,
  userId,
} = {}) {
  await ensureReferralRewardsSchema()
  const limit = Math.max(1, Math.min(pageSize, 100))
  const offset = (Math.max(1, page) - 1) * limit
  const filters = []
  const params = []

  if (status) {
    filters.push('wr.status = ?')
    params.push(status)
  }
  if (userId) {
    filters.push('wr.user_id = ?')
    params.push(userId)
  }

  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''

  const [rows] = await db.query(
    `SELECT wr.*, wu.nickname, wu.openid
     FROM withdrawal_requests wr
     LEFT JOIN wx_users wu ON wu.id = wr.user_id
     ${where}
     ORDER BY wr.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM withdrawal_requests wr ${where}`,
    params
  )

  return {
    items: rows || [],
    total: Number(countRows[0]?.total || 0),
    page: Math.max(1, page),
    pageSize: limit,
  }
}

module.exports = {
  adminResult,
  MIN_WITHDRAW_YUAN,
  requestWithdraw,
  processWithdrawTransfer,
  approveWithdrawalManually,
  failWithdrawal,
  listUserWithdrawals,
  listAdminWithdrawals,
  validateWithdrawAmount,
}
