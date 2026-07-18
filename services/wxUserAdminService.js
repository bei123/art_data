const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { revokeWxRefreshTokensForUser } = require('../utils/wxSessionTokens')

const PURGE_CONFIRM_PHRASE = '确认注销'
const REDIS_EXTERNAL_USER_KEY_PREFIX = 'external_user:'
const REDIS_EXTERNAL_USER_BY_WX_ID_KEY_PREFIX = 'external_user:wx_id:'

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function parseUserId(raw) {
  const id = parseInt(raw, 10)
  if (!Number.isFinite(id) || id <= 0) return null
  return id
}

function validatePurgeRequest({ userId, confirmUserId, confirmPhrase }) {
  const id = parseUserId(userId)
  if (!id) return { error: '无效的用户 ID' }

  const confirmId = parseUserId(confirmUserId)
  if (confirmId !== id) return { error: '确认用户 ID 不一致' }

  if (String(confirmPhrase || '').trim() !== PURGE_CONFIRM_PHRASE) {
    return { error: `请填写确认短语：${PURGE_CONFIRM_PHRASE}` }
  }

  return { userId: id }
}

function buildKeywordClause(keyword) {
  const trimmed = String(keyword || '').trim()
  if (!trimmed) return { clause: '', params: [] }

  const id = parseUserId(trimmed)
  if (id) {
    return {
      clause: 'WHERE wu.id = ?',
      params: [id],
    }
  }

  const like = `%${trimmed}%`
  return {
    clause: 'WHERE wu.nickname LIKE ? OR wu.phone LIKE ? OR wu.openid LIKE ?',
    params: [like, like, like],
  }
}

async function listWxUsersForAdmin({ page = 1, pageSize = 20, keyword } = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1)
  const safePageSize = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20))
  const offset = (safePage - 1) * safePageSize
  const { clause, params } = buildKeywordClause(keyword)

  const [countRows] = await db.query(
    `SELECT COUNT(*) AS total FROM wx_users wu ${clause}`,
    params
  )
  const total = countRows[0]?.total || 0

  const [items] = await db.query(
    `SELECT wu.id, wu.openid, wu.nickname, wu.phone, wu.avatar,
            wu.user_tier, wu.total_spent, wu.created_at, wu.updated_at
     FROM wx_users wu
     ${clause}
     ORDER BY wu.id DESC
     LIMIT ? OFFSET ?`,
    [...params, safePageSize, offset]
  )

  return {
    items,
    total,
    page: safePage,
    pageSize: safePageSize,
  }
}

async function getWxUserAdminDetail(userId) {
  const id = parseUserId(userId)
  if (!id) return adminResult(400, { error: '无效的用户 ID' })

  const [users] = await db.query(
    `SELECT id, openid, nickname, phone, avatar, user_tier, total_spent,
            tier_upgraded_at, created_at, updated_at
     FROM wx_users WHERE id = ? LIMIT 1`,
    [id]
  )
  if (!users.length) return adminResult(404, { error: '用户不存在' })

  const [statsRows] = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM orders WHERE user_id = ?) AS order_count,
       (SELECT COUNT(*) FROM orders WHERE referrer_id = ?) AS referred_order_count,
       (SELECT COUNT(*) FROM referral_bindings WHERE referrer_id = ? OR referee_id = ?) AS binding_count,
       (SELECT COUNT(*) FROM commission_ledger WHERE user_id = ? OR referee_id = ?) AS commission_count,
       (SELECT COUNT(*) FROM withdrawal_requests WHERE user_id = ?) AS withdrawal_count,
       (SELECT COUNT(*) FROM wx_favor_coupon_grants WHERE user_id = ? AND status = 'sent') AS coupon_count,
       (SELECT COUNT(*) FROM favorites WHERE user_id = ?) AS favorite_count,
       (SELECT COUNT(*) FROM cart_items WHERE user_id = ?) AS cart_count`,
    [id, id, id, id, id, id, id, id, id, id]
  )

  let referrer = null
  let referees = []
  let refereeTotal = 0

  try {
    const [asRefereeRows] = await db.query(
      `SELECT
          rb.id AS binding_id,
          rb.referrer_id,
          rb.referee_id,
          rb.source,
          rb.bound_at,
          rb.expires_at,
          (rb.expires_at IS NOT NULL AND rb.expires_at < NOW()) AS is_expired,
          wu.nickname AS referrer_nickname,
          wu.phone AS referrer_phone,
          wu.openid AS referrer_openid,
          wu.user_tier AS referrer_tier
       FROM referral_bindings rb
       LEFT JOIN wx_users wu ON wu.id = rb.referrer_id
       WHERE rb.referee_id = ?
       LIMIT 1`,
      [id]
    )
    if (asRefereeRows.length) {
      const row = asRefereeRows[0]
      referrer = {
        binding_id: row.binding_id,
        user_id: row.referrer_id,
        nickname: row.referrer_nickname,
        phone: row.referrer_phone,
        openid: row.referrer_openid,
        user_tier: row.referrer_tier,
        source: row.source,
        bound_at: row.bound_at,
        expires_at: row.expires_at,
        is_expired: Boolean(Number(row.is_expired)),
        role: 'referrer',
      }
    }

    const [refereeCountRows] = await db.query(
      `SELECT COUNT(*) AS total FROM referral_bindings WHERE referrer_id = ?`,
      [id]
    )
    refereeTotal = Number(refereeCountRows[0]?.total || 0)

    const [asReferrerRows] = await db.query(
      `SELECT
          rb.id AS binding_id,
          rb.referrer_id,
          rb.referee_id,
          rb.source,
          rb.bound_at,
          rb.expires_at,
          (rb.expires_at IS NOT NULL AND rb.expires_at < NOW()) AS is_expired,
          wu.nickname AS referee_nickname,
          wu.phone AS referee_phone,
          wu.openid AS referee_openid,
          wu.user_tier AS referee_tier
       FROM referral_bindings rb
       LEFT JOIN wx_users wu ON wu.id = rb.referee_id
       WHERE rb.referrer_id = ?
       ORDER BY rb.bound_at DESC, rb.id DESC
       LIMIT 100`,
      [id]
    )
    referees = (asReferrerRows || []).map((row) => ({
      binding_id: row.binding_id,
      user_id: row.referee_id,
      nickname: row.referee_nickname,
      phone: row.referee_phone,
      openid: row.referee_openid,
      user_tier: row.referee_tier,
      source: row.source,
      bound_at: row.bound_at,
      expires_at: row.expires_at,
      is_expired: Boolean(Number(row.is_expired)),
      role: 'referee',
    }))
  } catch (err) {
    if (err.code !== 'ER_NO_SUCH_TABLE') {
      logger.warn('wx user detail referral bindings failed', { userId: id, message: err.message })
    }
  }

  return adminResult(200, {
    user: users[0],
    stats: statsRows[0] || {},
    referral: {
      referrer,
      referees,
      referee_total: refereeTotal,
      referee_truncated: refereeTotal > referees.length,
    },
  })
}

async function safeDelete(conn, sql, params, label) {
  try {
    const [result] = await conn.query(sql, params)
    return result.affectedRows || 0
  } catch (err) {
    if (err.code === 'ER_NO_SUCH_TABLE') return 0
    logger.warn('wx user purge step failed', { label, message: err.message })
    throw err
  }
}

async function clearExternalUserCache(conn, userId) {
  try {
    const [rows] = await conn.query(
      'SELECT usn FROM external_users WHERE wx_user_id = ?',
      [userId]
    )
    for (const row of rows) {
      if (row.usn) {
        await redisClient.del(`${REDIS_EXTERNAL_USER_KEY_PREFIX}${row.usn}`)
      }
    }
    await redisClient.del(`${REDIS_EXTERNAL_USER_BY_WX_ID_KEY_PREFIX}${userId}`)
  } catch (err) {
    logger.warn('wx user purge redis cache clear failed', { userId, message: err.message })
  }
}

async function purgeWxUserData(connection, userId) {
  const counts = {}

  const [orders] = await connection.query(
    'SELECT id, out_trade_no FROM orders WHERE user_id = ?',
    [userId]
  )
  const orderIds = orders.map((row) => row.id)
  const outTradeNos = orders.map((row) => row.out_trade_no).filter(Boolean)

  counts.sessions = await safeDelete(
    connection,
    'DELETE FROM wx_user_sessions WHERE user_id = ?',
    [userId],
    'wx_user_sessions'
  )
  await revokeWxRefreshTokensForUser(userId)
  counts.refresh_tokens = await safeDelete(
    connection,
    'DELETE FROM wx_refresh_tokens WHERE user_id = ?',
    [userId],
    'wx_refresh_tokens'
  )

  if (orderIds.length) {
    counts.commission_ledger = await safeDelete(
      connection,
      'DELETE FROM commission_ledger WHERE user_id = ? OR referee_id = ? OR order_id IN (?)',
      [userId, userId, orderIds],
      'commission_ledger'
    )
    counts.referral_bonus_grants = await safeDelete(
      connection,
      'DELETE FROM referral_bonus_grants WHERE user_id = ? OR order_id IN (?)',
      [userId, orderIds],
      'referral_bonus_grants'
    )
  } else {
    counts.commission_ledger = await safeDelete(
      connection,
      'DELETE FROM commission_ledger WHERE user_id = ? OR referee_id = ?',
      [userId, userId],
      'commission_ledger'
    )
    counts.referral_bonus_grants = await safeDelete(
      connection,
      'DELETE FROM referral_bonus_grants WHERE user_id = ?',
      [userId],
      'referral_bonus_grants'
    )
  }

  counts.withdrawal_requests = await safeDelete(
    connection,
    'DELETE FROM withdrawal_requests WHERE user_id = ?',
    [userId],
    'withdrawal_requests'
  )
  counts.user_wallets = await safeDelete(
    connection,
    'DELETE FROM user_wallets WHERE user_id = ?',
    [userId],
    'user_wallets'
  )
  counts.user_referral_coupons = await safeDelete(
    connection,
    'DELETE FROM user_referral_coupons WHERE user_id = ?',
    [userId],
    'user_referral_coupons'
  )
  counts.wx_favor_coupon_grants = await safeDelete(
    connection,
    'DELETE FROM wx_favor_coupon_grants WHERE user_id = ?',
    [userId],
    'wx_favor_coupon_grants'
  )
  counts.art_advisor_applications = await safeDelete(
    connection,
    'DELETE FROM art_advisor_applications WHERE user_id = ?',
    [userId],
    'art_advisor_applications'
  )
  counts.share_events = await safeDelete(
    connection,
    'DELETE FROM share_events WHERE user_id = ?',
    [userId],
    'share_events'
  )
  counts.referral_bindings = await safeDelete(
    connection,
    'DELETE FROM referral_bindings WHERE referrer_id = ? OR referee_id = ?',
    [userId, userId],
    'referral_bindings'
  )
  counts.referral_attributions = await safeDelete(
    connection,
    'DELETE FROM referral_attributions WHERE user_id = ? OR referrer_id = ?',
    [userId, userId],
    'referral_attributions'
  )
  counts.referral_codes = await safeDelete(
    connection,
    'DELETE FROM referral_codes WHERE user_id = ?',
    [userId],
    'referral_codes'
  )

  if (outTradeNos.length) {
    counts.refund_requests = await safeDelete(
      connection,
      'DELETE FROM refund_requests WHERE out_trade_no IN (?)',
      [outTradeNos],
      'refund_requests'
    )
  }

  if (orderIds.length) {
    counts.digital_identity_purchases = await safeDelete(
      connection,
      'DELETE FROM digital_identity_purchases WHERE user_id = ? OR order_id IN (?)',
      [userId, orderIds],
      'digital_identity_purchases'
    )
    counts.order_shipments = await safeDelete(
      connection,
      'DELETE FROM order_shipments WHERE order_id IN (?)',
      [orderIds],
      'order_shipments'
    )
    counts.order_items = await safeDelete(
      connection,
      'DELETE FROM order_items WHERE order_id IN (?)',
      [orderIds],
      'order_items'
    )
    counts.orders = await safeDelete(
      connection,
      'DELETE FROM orders WHERE user_id = ?',
      [userId],
      'orders'
    )
  } else {
    counts.digital_identity_purchases = await safeDelete(
      connection,
      'DELETE FROM digital_identity_purchases WHERE user_id = ?',
      [userId],
      'digital_identity_purchases'
    )
  }

  const [referrerUpdate] = await connection.query(
    'UPDATE orders SET referrer_id = NULL WHERE referrer_id = ?',
    [userId]
  )
  counts.referrer_cleared_orders = referrerUpdate.affectedRows || 0

  counts.cart_items = await safeDelete(
    connection,
    'DELETE FROM cart_items WHERE user_id = ?',
    [userId],
    'cart_items'
  )
  counts.favorites = await safeDelete(
    connection,
    'DELETE FROM favorites WHERE user_id = ?',
    [userId],
    'favorites'
  )
  counts.wx_user_addresses = await safeDelete(
    connection,
    'DELETE FROM wx_user_addresses WHERE user_id = ?',
    [userId],
    'wx_user_addresses'
  )
  counts.real_name_registrations = await safeDelete(
    connection,
    'DELETE FROM real_name_registrations WHERE user_id = ?',
    [userId],
    'real_name_registrations'
  )

  await clearExternalUserCache(connection, userId)
  counts.external_users = await safeDelete(
    connection,
    'DELETE FROM external_users WHERE wx_user_id = ?',
    [userId],
    'external_users'
  )

  const [deleteUser] = await connection.query('DELETE FROM wx_users WHERE id = ?', [userId])
  counts.wx_users = deleteUser.affectedRows || 0

  return counts
}

async function purgeWxUser({ userId, confirmUserId, confirmPhrase, adminUserId }) {
  const validation = validatePurgeRequest({ userId, confirmUserId, confirmPhrase })
  if (validation.error) return adminResult(400, { error: validation.error })

  const connection = await db.getConnection()

  try {
    await connection.beginTransaction()

    const [users] = await connection.query(
      'SELECT id, openid, nickname FROM wx_users WHERE id = ? FOR UPDATE',
      [validation.userId]
    )
    if (!users.length) {
      await connection.rollback()
      return adminResult(404, { error: '用户不存在' })
    }

    const deletedCounts = await purgeWxUserData(connection, validation.userId)

    await connection.commit()

    logger.warn('wx user purged by admin', {
      userId: validation.userId,
      adminUserId,
      openid: users[0].openid,
      nickname: users[0].nickname,
      deletedCounts,
    })

    return adminResult(200, {
      success: true,
      userId: validation.userId,
      deleted: deletedCounts,
    })
  } catch (error) {
    await connection.rollback()
    logger.error('purge wx user failed', { userId: validation.userId, adminUserId, err: error })
    return adminResult(500, { error: '注销用户失败，请稍后重试' })
  } finally {
    connection.release()
  }
}

module.exports = {
  PURGE_CONFIRM_PHRASE,
  validatePurgeRequest,
  listWxUsersForAdmin,
  getWxUserAdminDetail,
  purgeWxUser,
}
