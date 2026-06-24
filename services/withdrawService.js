const crypto = require('crypto')
const db = require('../db')
const logger = require('../utils/logger')
const { ensureReferralRewardsSchema } = require('../utils/referralRewardsSchema')
const { ensureCommissionSchema } = require('../utils/commissionSchema')
const { ensureWallet, adjustWalletBalances, roundMoney, parseMoney } = require('./commissionService')
const {
  createTransferToWallet,
  isTransferConfigured,
  queryTransferByOutBillNo,
  getTransferClientConfig,
  normalizeTransferBill,
  TERMINAL_SUCCESS_STATES,
  TERMINAL_FAIL_STATES,
  AWAIT_CONFIRM_STATES,
} = require('./wechatTransferService')

const ACTIVE_WITHDRAWAL_STATUSES = ['pending', 'processing', 'await_confirm']

const MIN_WITHDRAW_YUAN = parseFloat(process.env.MIN_WITHDRAW_YUAN || '0')
const MAX_WITHDRAW_YUAN = parseFloat(process.env.MAX_WITHDRAW_YUAN || '200')
const USER_DAILY_WITHDRAW_LIMIT_YUAN = parseFloat(
  process.env.USER_DAILY_WITHDRAW_LIMIT_YUAN
  || process.env.DAILY_WITHDRAW_LIMIT_YUAN
  || '2000'
)
const MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN = parseFloat(
  process.env.MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN || '50000'
)

function getWithdrawPolicy() {
  return {
    min_yuan: MIN_WITHDRAW_YUAN,
    max_yuan: MAX_WITHDRAW_YUAN,
    user_daily_limit_yuan: USER_DAILY_WITHDRAW_LIMIT_YUAN,
    merchant_daily_limit_yuan: MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN,
  }
}

function computeWithdrawCap({
  availableYuan,
  userTodayYuan = 0,
  merchantTodayYuan = 0,
}) {
  const available = roundMoney(availableYuan)
  if (available <= 0) return 0

  const caps = [available]
  if (MAX_WITHDRAW_YUAN > 0) caps.push(MAX_WITHDRAW_YUAN)
  if (USER_DAILY_WITHDRAW_LIMIT_YUAN > 0) {
    caps.push(Math.max(0, roundMoney(USER_DAILY_WITHDRAW_LIMIT_YUAN - roundMoney(userTodayYuan))))
  }
  if (MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN > 0) {
    caps.push(Math.max(0, roundMoney(MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN - roundMoney(merchantTodayYuan))))
  }

  return roundMoney(Math.min(...caps))
}

function isAdminApprovalRequiredForTransfer() {
  return String(process.env.WX_WITHDRAW_REQUIRE_ADMIN_APPROVAL || 'false').toLowerCase() === 'true'
}

function shouldTransferOnUserRequest() {
  if (!isTransferConfigured()) return false
  if (isAdminApprovalRequiredForTransfer()) return false
  return true
}

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
       AND status IN ('pending', 'processing', 'await_confirm', 'success')
       AND created_at >= CURDATE()`,
    [userId]
  )
  return parseMoney(rows[0]?.total)
}

async function sumMerchantTodayWithdrawnYuan(connection = db) {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(amount), 0) AS total
     FROM withdrawal_requests
     WHERE status IN ('pending', 'processing', 'await_confirm', 'success')
       AND created_at >= CURDATE()`
  )
  return parseMoney(rows[0]?.total)
}

async function hasActiveWithdrawal(userId, connection = db) {
  const [rows] = await connection.query(
    `SELECT id FROM withdrawal_requests
     WHERE user_id = ? AND status IN ('pending', 'processing', 'await_confirm')
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
    return { ok: false, error: '当前佣金明细暂不支持该金额提现，请尝试更低金额或联系客服' }
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

    const todayUserTotal = await sumTodayWithdrawnYuan(userId, connection)
    const todayMerchantTotal = await sumMerchantTodayWithdrawnYuan(connection)

    const targetAmount = withdrawAll
      ? computeWithdrawCap({
        availableYuan: available,
        userTodayYuan: todayUserTotal,
        merchantTodayYuan: todayMerchantTotal,
      })
      : parseMoney(amountYuan)

    if (withdrawAll && targetAmount <= 0) {
      await connection.rollback()
      if (USER_DAILY_WITHDRAW_LIMIT_YUAN > 0 && todayUserTotal >= USER_DAILY_WITHDRAW_LIMIT_YUAN) {
        return adminResult(400, { error: `您今日提现已达上限 ${USER_DAILY_WITHDRAW_LIMIT_YUAN} 元` })
      }
      if (MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN > 0 && todayMerchantTotal >= MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN) {
        return adminResult(400, { error: '商户今日转账额度已用尽，请明日再试' })
      }
      return adminResult(400, { error: '当前暂无可提现金额' })
    }

    const validation = validateWithdrawAmount(targetAmount, available)
    if (!validation.ok) {
      await connection.rollback()
      return adminResult(400, { error: validation.error })
    }

    if (await hasActiveWithdrawal(userId, connection)) {
      await connection.rollback()
      return adminResult(409, { error: '已有进行中的提现申请，请完成后再试' })
    }

    if (USER_DAILY_WITHDRAW_LIMIT_YUAN > 0 && todayUserTotal + validation.amount > USER_DAILY_WITHDRAW_LIMIT_YUAN) {
      await connection.rollback()
      const remain = roundMoney(USER_DAILY_WITHDRAW_LIMIT_YUAN - todayUserTotal)
      return adminResult(400, {
        error: remain > 0
          ? `今日剩余可提现 ${remain} 元`
          : `您今日提现已达上限 ${USER_DAILY_WITHDRAW_LIMIT_YUAN} 元`,
      })
    }

    if (MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN > 0 && todayMerchantTotal + validation.amount > MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN) {
      await connection.rollback()
      return adminResult(400, { error: '商户今日转账额度已用尽，请明日再试' })
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
    let transferResult = { status: 'pending', manualReview: !isTransferConfigured() }

    if (shouldTransferOnUserRequest()) {
      transferResult = await processWithdrawTransfer(withdrawalId)
    }

    return adminResult(200, {
      success: true,
      withdrawal_id: withdrawalId,
      amount_yuan: validation.amount,
      status: transferResult.status || 'pending',
      need_user_confirm: Boolean(transferResult.needUserConfirm),
      manual_review: transferResult.manualReview || !shouldTransferOnUserRequest(),
      awaiting_admin_approval: !shouldTransferOnUserRequest() && isTransferConfigured(),
      withdraw_cap_yuan: validation.amount,
      limits: getWithdrawPolicy(),
    })
  } catch (err) {
    await connection.rollback()
    logger.error('requestWithdraw failed', { userId, err: err.message })
    throw err
  } finally {
    connection.release()
  }
}

async function mapWechatStateToWithdrawalStatus(wxState) {
  if (TERMINAL_SUCCESS_STATES.has(wxState)) return 'success'
  if (TERMINAL_FAIL_STATES.has(wxState)) return 'failed'
  if (AWAIT_CONFIRM_STATES.has(wxState)) return 'await_confirm'
  return 'processing'
}

async function completeWithdrawalSuccess(withdrawalId, { transferBillNo, wxState, packageInfo } = {}) {
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
      return { ok: false, status: null }
    }
    if (row.status === 'success') {
      await connection.commit()
      return { ok: true, status: 'success', alreadyDone: true }
    }

    await connection.query(
      `UPDATE withdrawal_requests
       SET status = 'success',
           wx_transfer_id = COALESCE(?, wx_transfer_id),
           wx_state = ?,
           wx_package_info = COALESCE(?, wx_package_info),
           fail_reason = NULL,
           processed_at = NOW(),
           updated_at = NOW()
       WHERE id = ?`,
      [transferBillNo || null, wxState || 'SUCCESS', packageInfo || null, withdrawalId]
    )

    await connection.query(
      `UPDATE user_wallets
       SET total_withdrawn = total_withdrawn + ?, updated_at = NOW()
       WHERE user_id = ?`,
      [row.amount, row.user_id]
    )

    await connection.commit()
    return { ok: true, status: 'success' }
  } catch (err) {
    await connection.rollback()
    throw err
  } finally {
    connection.release()
  }
}

async function applyWechatBillToWithdrawal(withdrawalId, bill) {
  if (!bill || !bill.state) {
    return { ok: false, error: '转账单状态无效' }
  }

  const wxState = bill.state
  const mappedStatus = await mapWechatStateToWithdrawalStatus(wxState)

  if (TERMINAL_SUCCESS_STATES.has(wxState)) {
    const result = await completeWithdrawalSuccess(withdrawalId, {
      transferBillNo: bill.transferBillNo,
      wxState,
      packageInfo: bill.packageInfo,
    })
    return { ...result, needUserConfirm: false }
  }

  if (TERMINAL_FAIL_STATES.has(wxState)) {
    await failWithdrawal(withdrawalId, bill.failReason || '微信转账失败')
    return { ok: false, status: 'failed', needUserConfirm: false }
  }

  const packageInfo = bill.packageInfo || null
  await db.query(
    `UPDATE withdrawal_requests
     SET status = ?,
         wx_transfer_id = COALESCE(?, wx_transfer_id),
         wx_state = ?,
         wx_package_info = COALESCE(?, wx_package_info),
         updated_at = NOW()
     WHERE id = ?`,
    [
      mappedStatus,
      bill.transferBillNo || null,
      wxState,
      packageInfo,
      withdrawalId,
    ]
  )

  return {
    ok: true,
    status: mappedStatus,
    needUserConfirm: mappedStatus === 'await_confirm',
    packageInfo,
    wxState,
  }
}

async function resolveTransferCreateFailure(withdrawalId, outBillNo, errorMessage) {
  const queried = await queryTransferByOutBillNo(outBillNo)
  if (queried.ok && queried.bill) {
    return applyWechatBillToWithdrawal(withdrawalId, queried.bill)
  }

  if (queried.httpStatus === 404) {
    await failWithdrawal(withdrawalId, errorMessage || '微信转账失败')
    return { ok: false, status: 'failed', error: errorMessage }
  }

  return {
    ok: false,
    status: 'processing',
    error: errorMessage || '转账结果待确认，请稍后查询',
    shouldRetryLater: true,
  }
}

async function processWithdrawTransfer(withdrawalId) {
  await ensureReferralRewardsSchema()

  const [rows] = await db.query(
    `SELECT id, user_id, amount, status, out_bill_no FROM withdrawal_requests WHERE id = ? LIMIT 1`,
    [withdrawalId]
  )
  const row = rows[0]
  if (!row || !ACTIVE_WITHDRAWAL_STATUSES.includes(row.status)) {
    return { ok: false, status: row?.status }
  }

  if (!isTransferConfigured()) {
    return { ok: true, status: 'pending', manualReview: true }
  }

  const openid = await getUserOpenid(row.user_id)
  if (!openid) {
    await failWithdrawal(withdrawalId, '用户 openid 缺失')
    return { ok: false, status: 'failed', error: '用户 openid 缺失' }
  }

  if (row.status === 'pending') {
    await db.query(
      `UPDATE withdrawal_requests SET status = 'processing', updated_at = NOW() WHERE id = ?`,
      [withdrawalId]
    )
  } else {
    const queried = await queryTransferByOutBillNo(row.out_bill_no)
    if (queried.ok && queried.bill) {
      return applyWechatBillToWithdrawal(withdrawalId, queried.bill)
    }
  }

  const transfer = await createTransferToWallet({
    openid,
    outBillNo: row.out_bill_no,
    amountYuan: row.amount,
  })

  if (!transfer.ok) {
    return resolveTransferCreateFailure(withdrawalId, row.out_bill_no, transfer.error)
  }

  const bill = transfer.bill || {
    transferBillNo: transfer.transferId,
    state: transfer.state,
    packageInfo: transfer.packageInfo,
  }

  return applyWechatBillToWithdrawal(withdrawalId, bill)
}

async function syncWithdrawalFromWechat(withdrawalId, { userId } = {}) {
  await ensureReferralRewardsSchema()

  const [rows] = await db.query(
    `SELECT id, user_id, out_bill_no, status FROM withdrawal_requests WHERE id = ? LIMIT 1`,
    [withdrawalId]
  )
  const row = rows[0]
  if (!row) {
    return adminResult(404, { error: '提现记录不存在' })
  }
  if (userId && row.user_id !== userId) {
    return adminResult(403, { error: '无权操作该提现记录' })
  }
  if (!row.out_bill_no) {
    return adminResult(400, { error: '缺少商户单号' })
  }
  if (!isTransferConfigured()) {
    return adminResult(400, { error: '微信自动转账未启用' })
  }

  const queried = await queryTransferByOutBillNo(row.out_bill_no)
  if (!queried.ok) {
    return adminResult(502, { error: queried.error || '查询转账单失败' })
  }

  const result = await applyWechatBillToWithdrawal(withdrawalId, queried.bill)
  return adminResult(200, {
    success: Boolean(result.ok),
    status: result.status,
    need_user_confirm: Boolean(result.needUserConfirm),
    wx_state: queried.bill.state,
  })
}

async function getWithdrawalConfirmInfo(userId, withdrawalId) {
  await ensureReferralRewardsSchema()

  const syncResult = await syncWithdrawalFromWechat(withdrawalId, { userId })
  if (!syncResult.ok) return syncResult

  const [rows] = await db.query(
    `SELECT id, status, wx_state, wx_package_info, amount
     FROM withdrawal_requests
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [withdrawalId, userId]
  )
  const row = rows[0]
  if (!row) {
    return adminResult(404, { error: '提现记录不存在' })
  }

  if (row.status !== 'await_confirm' || row.wx_state !== 'WAIT_USER_CONFIRM') {
    return adminResult(400, {
      error: '当前状态不可拉起确认收款',
      status: row.status,
      wx_state: row.wx_state,
    })
  }
  if (!row.wx_package_info) {
    return adminResult(400, { error: '缺少收款确认参数，请稍后重试' })
  }

  const clientConfig = getTransferClientConfig()
  if (!clientConfig.mchId || !clientConfig.appId) {
    return adminResult(500, { error: '商户转账配置不完整' })
  }

  return adminResult(200, {
    withdrawal_id: row.id,
    amount_yuan: parseMoney(row.amount),
    status: row.status,
    wx_state: row.wx_state,
    mch_id: clientConfig.mchId,
    app_id: clientConfig.appId,
    package: row.wx_package_info,
  })
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

  const [rows] = await db.query(
    `SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ? LIMIT 1`,
    [withdrawalId]
  )
  const row = rows[0]
  if (!row) {
    return adminResult(404, { error: '提现记录不存在' })
  }
  if (row.status === 'success') {
    return adminResult(200, { success: true, alreadyDone: true, status: 'success' })
  }
  if (!['pending', 'failed'].includes(row.status)) {
    return adminResult(400, {
      error: '当前状态不可审核，请使用重试转账或等待用户确认收款',
      status: row.status,
    })
  }

  if (isTransferConfigured()) {
    const transferResult = await processWithdrawTransfer(withdrawalId)
    return adminResult(200, {
      success: Boolean(transferResult.ok),
      status: transferResult.status || 'processing',
      need_user_confirm: Boolean(transferResult.needUserConfirm),
      wx_state: transferResult.wxState || null,
      error: transferResult.error || null,
      message: transferResult.needUserConfirm
        ? '已发起微信转账，请通知用户在小程序内确认收款'
        : (transferResult.ok ? '转账处理中' : (transferResult.error || '发起转账失败')),
    })
  }

  const connection = await db.getConnection()
  try {
    await connection.beginTransaction()

    const [lockedRows] = await connection.query(
      `SELECT id, user_id, amount, status FROM withdrawal_requests WHERE id = ? FOR UPDATE`,
      [withdrawalId]
    )
    const locked = lockedRows[0]
    if (!locked || locked.status === 'success') {
      await connection.rollback()
      return adminResult(200, { success: true, alreadyDone: true, status: 'success' })
    }
    if (!['pending', 'failed'].includes(locked.status)) {
      await connection.rollback()
      return adminResult(400, { error: '当前状态不可确认打款', status: locked.status })
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
      [locked.amount, locked.user_id]
    )

    await connection.commit()
    return adminResult(200, {
      success: true,
      status: 'success',
      message: '已标记为线下打款完成',
    })
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
  const todayUserTotal = await sumTodayWithdrawnYuan(userId)
  const todayMerchantTotal = await sumMerchantTodayWithdrawnYuan()
  const [walletRows] = await db.query(
    'SELECT available_balance FROM user_wallets WHERE user_id = ? LIMIT 1',
    [userId]
  )
  const available = parseMoney(walletRows[0]?.available_balance)
  const withdrawCapYuan = computeWithdrawCap({
    availableYuan: available,
    userTodayYuan: todayUserTotal,
    merchantTodayYuan: todayMerchantTotal,
  })

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
    ...getWithdrawPolicy(),
    withdraw_cap_yuan: withdrawCapYuan,
    user_today_withdrawn_yuan: todayUserTotal,
    auto_transfer_enabled: isTransferConfigured(),
    require_admin_approval: isAdminApprovalRequiredForTransfer(),
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
    ...getWithdrawPolicy(),
    auto_transfer_enabled: isTransferConfigured(),
    require_admin_approval: isAdminApprovalRequiredForTransfer(),
  }
}

const TRANSFER_NOTIFY_EVENT = 'MCHTRANSFER.BILL.FINISHED'
const EXPECTED_MCH_ID = process.env.WX_PAY_MCH_ID || null

async function applyTransferNotifyBill(bill, { notifyId } = {}) {
  await ensureReferralRewardsSchema()

  if (!bill || !bill.outBillNo || !bill.state) {
    return { ok: false, error: '转账通知数据无效' }
  }

  if (!TERMINAL_SUCCESS_STATES.has(bill.state) && !TERMINAL_FAIL_STATES.has(bill.state)) {
    logger.info('transfer notify ignored non-terminal state', {
      notifyId,
      outBillNo: bill.outBillNo,
      state: bill.state,
    })
    return { ok: true, ignored: true }
  }

  if (EXPECTED_MCH_ID && bill.mchId && bill.mchId !== EXPECTED_MCH_ID) {
    logger.error('transfer notify mch_id mismatch', {
      notifyId,
      outBillNo: bill.outBillNo,
      expected: EXPECTED_MCH_ID,
      got: bill.mchId,
    })
    return { ok: false, error: '商户号不匹配' }
  }

  const [rows] = await db.query(
    `SELECT id, amount, status FROM withdrawal_requests WHERE out_bill_no = ? LIMIT 1`,
    [bill.outBillNo]
  )
  const row = rows[0]
  if (!row) {
    logger.warn('transfer notify withdrawal not found', {
      notifyId,
      outBillNo: bill.outBillNo,
      state: bill.state,
    })
    return { ok: true, ignored: true, notFound: true }
  }

  if (bill.transferAmount != null) {
    const expectedFen = Math.round(parseMoney(row.amount) * 100)
    if (expectedFen !== bill.transferAmount) {
      logger.error('transfer notify amount mismatch', {
        notifyId,
        outBillNo: bill.outBillNo,
        expectedFen,
        gotFen: bill.transferAmount,
      })
      return { ok: false, error: '转账金额不匹配' }
    }
  }

  if (row.status === 'success' && bill.state === 'SUCCESS') {
    return { ok: true, status: 'success', alreadyDone: true }
  }
  if (row.status === 'failed' && TERMINAL_FAIL_STATES.has(bill.state)) {
    return { ok: true, status: 'failed', alreadyDone: true }
  }
  if (row.status === 'cancelled' && bill.state === 'CANCELLED') {
    return { ok: true, status: 'cancelled', alreadyDone: true }
  }

  return applyWechatBillToWithdrawal(row.id, bill)
}

async function handleTransferNotify(req) {
  const {
    parseAndVerifyWechatPayNotify,
    decryptWechatPayNotifyPayload,
    notifySuccessResult,
    notifyFailResult,
  } = require('../utils/wechatPayNotify')

  const verified = parseAndVerifyWechatPayNotify(req)
  if (!verified.ok) {
    return notifyFailResult(verified.status, verified.error)
  }

  const { payload } = verified
  const notifyId = payload.id || null

  if (payload.event_type !== TRANSFER_NOTIFY_EVENT) {
    logger.info('transfer notify ignored event', {
      notifyId,
      eventType: payload.event_type,
    })
    return notifySuccessResult()
  }

  if (!payload.resource) {
    return notifyFailResult(400, '回调数据格式错误')
  }

  let billData
  try {
    billData = decryptWechatPayNotifyPayload(payload)
  } catch (err) {
    logger.error('transfer notify decrypt failed', { notifyId, err: err.message })
    return notifyFailResult(400, '解密失败')
  }

  const bill = normalizeTransferBill(billData)
  if (!bill) {
    return notifyFailResult(400, '转账通知解析失败')
  }

  try {
    const result = await applyTransferNotifyBill(bill, { notifyId })
    if (!result.ok && !result.ignored) {
      logger.error('transfer notify business failed', {
        notifyId,
        outBillNo: bill.outBillNo,
        state: bill.state,
        error: result.error,
      })
      return notifyFailResult(500, result.error || '处理失败')
    }

    logger.info('transfer notify handled', {
      notifyId,
      outBillNo: bill.outBillNo,
      state: bill.state,
      status: result.status,
      alreadyDone: Boolean(result.alreadyDone),
      ignored: Boolean(result.ignored),
    })
    return notifySuccessResult()
  } catch (err) {
    logger.error('transfer notify handle failed', {
      notifyId,
      outBillNo: bill.outBillNo,
      err: err.message,
    })
    return notifyFailResult(500, '处理失败')
  }
}

module.exports = {
  adminResult,
  MIN_WITHDRAW_YUAN,
  MAX_WITHDRAW_YUAN,
  USER_DAILY_WITHDRAW_LIMIT_YUAN,
  MERCHANT_DAILY_WITHDRAW_LIMIT_YUAN,
  getWithdrawPolicy,
  computeWithdrawCap,
  isAdminApprovalRequiredForTransfer,
  shouldTransferOnUserRequest,
  requestWithdraw,
  processWithdrawTransfer,
  syncWithdrawalFromWechat,
  getWithdrawalConfirmInfo,
  approveWithdrawalManually,
  failWithdrawal,
  listUserWithdrawals,
  listAdminWithdrawals,
  validateWithdrawAmount,
  mapWechatStateToWithdrawalStatus,
  handleTransferNotify,
  applyTransferNotifyBill,
}
