const db = require('../db')
const logger = require('../utils/logger')

const USER_TIERS = {
  NORMAL: 'normal',
  RECOMMENDER: 'recommender',
  VIP_COLLECTOR: 'vip_collector',
  ART_ADVISOR: 'art_advisor',
}

const VIP_SPEND_THRESHOLD_YUAN = parseFloat(process.env.VIP_SPEND_THRESHOLD_YUAN || '5000')

const TIER_LABELS = {
  [USER_TIERS.NORMAL]: '普通用户',
  [USER_TIERS.RECOMMENDER]: '艺术推荐官',
  [USER_TIERS.VIP_COLLECTOR]: 'VIP收藏家',
  [USER_TIERS.ART_ADVISOR]: '艺术顾问',
}

function parseMoney(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

function isRecommenderOrAbove(tier) {
  return tier === USER_TIERS.RECOMMENDER
    || tier === USER_TIERS.VIP_COLLECTOR
    || tier === USER_TIERS.ART_ADVISOR
}

async function fetchWxUserTierRow(userId, connection = db) {
  const [rows] = await connection.query(
    'SELECT id, user_tier, total_spent, tier_upgraded_at FROM wx_users WHERE id = ? LIMIT 1',
    [userId]
  )
  return rows[0] || null
}

async function getUserTierProfile(userId, connection = db) {
  const row = await fetchWxUserTierRow(userId, connection)
  if (!row) return null

  const tier = row.user_tier || USER_TIERS.NORMAL
  const totalSpent = parseMoney(row.total_spent)
  const vipProgress = {
    threshold_yuan: VIP_SPEND_THRESHOLD_YUAN,
    remaining_yuan: Math.max(0, VIP_SPEND_THRESHOLD_YUAN - totalSpent),
    is_vip: tier === USER_TIERS.VIP_COLLECTOR || tier === USER_TIERS.ART_ADVISOR,
  }

  return {
    user_id: row.id,
    tier,
    tier_label: TIER_LABELS[tier] || TIER_LABELS[USER_TIERS.NORMAL],
    total_spent_yuan: totalSpent,
    tier_upgraded_at: row.tier_upgraded_at,
    is_recommender: isRecommenderOrAbove(tier),
    vip_progress: vipProgress,
  }
}

async function setUserTier(userId, nextTier, connection = db) {
  await connection.query(
    'UPDATE wx_users SET user_tier = ?, tier_upgraded_at = NOW(), updated_at = NOW() WHERE id = ?',
    [nextTier, userId]
  )
}

async function tryUpgradeToRecommender(userId, reason, connection = db) {
  const row = await fetchWxUserTierRow(userId, connection)
  if (!row) return { upgraded: false, reason: 'user_not_found' }

  const currentTier = row.user_tier || USER_TIERS.NORMAL
  if (isRecommenderOrAbove(currentTier)) {
    return { upgraded: false, reason: 'already_recommender', tier: currentTier }
  }

  await setUserTier(userId, USER_TIERS.RECOMMENDER, connection)
  const { ensureReferralCode } = require('./referralService')
  await ensureReferralCode(userId, connection)

  logger.info('user upgraded to recommender', { userId, trigger: reason })

  return { upgraded: true, tier: USER_TIERS.RECOMMENDER }
}

async function recalculateVipTier(userId, connection = db) {
  const row = await fetchWxUserTierRow(userId, connection)
  if (!row) return { upgraded: false, reason: 'user_not_found' }

  const currentTier = row.user_tier || USER_TIERS.NORMAL
  if (currentTier === USER_TIERS.ART_ADVISOR) {
    return { upgraded: false, reason: 'art_advisor_locked', tier: currentTier }
  }

  const totalSpent = parseMoney(row.total_spent)
  if (totalSpent < VIP_SPEND_THRESHOLD_YUAN) {
    return { upgraded: false, reason: 'below_threshold', tier: currentTier }
  }

  if (currentTier === USER_TIERS.VIP_COLLECTOR) {
    return { upgraded: false, reason: 'already_vip', tier: currentTier }
  }

  await setUserTier(userId, USER_TIERS.VIP_COLLECTOR, connection)
  const { ensureReferralCode } = require('./referralService')
  await ensureReferralCode(userId, connection)

  logger.info('user upgraded to vip_collector', { userId, totalSpent })

  return { upgraded: true, tier: USER_TIERS.VIP_COLLECTOR }
}

async function onPaymentSuccess(userId, amountYuan, connection = db) {
  const paidAmount = parseMoney(amountYuan)
  if (!userId || paidAmount <= 0) return { ok: false, reason: 'invalid_input' }

  await connection.query(
    'UPDATE wx_users SET total_spent = total_spent + ?, updated_at = NOW() WHERE id = ?',
    [paidAmount, userId]
  )

  const recommenderResult = await tryUpgradeToRecommender(userId, 'purchase', connection)
  const vipResult = await recalculateVipTier(userId, connection)

  return {
    ok: true,
    recommender: recommenderResult,
    vip: vipResult,
  }
}

module.exports = {
  USER_TIERS,
  VIP_SPEND_THRESHOLD_YUAN,
  TIER_LABELS,
  getUserTierProfile,
  setUserTier,
  tryUpgradeToRecommender,
  recalculateVipTier,
  onPaymentSuccess,
  isRecommenderOrAbove,
}
