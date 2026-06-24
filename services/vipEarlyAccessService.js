const db = require('../db')
const logger = require('../utils/logger')
const { ensureVipEarlyAccessSchema, PRODUCT_TABLES } = require('../utils/vipEarlyAccessSchema')
const { USER_TIERS, getUserTierProfile } = require('./userTierService')

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function isVipTier(tier) {
  return tier === USER_TIERS.VIP_COLLECTOR || tier === USER_TIERS.ART_ADVISOR
}

function isVipEarlyAccessActive(goods, now = new Date()) {
  if (!goods || Number(goods.vip_early_access) !== 1) return false
  if (!goods.vip_early_until) return true
  return new Date(goods.vip_early_until) > now
}

async function canUserBypassVipEarlyAccess(userId, connection = db) {
  const profile = await getUserTierProfile(userId, connection)
  if (!profile) return false
  return isVipTier(profile.tier)
}

function buildVipEarlyAccessError(productTitle) {
  const name = productTitle ? `「${productTitle}」` : '该作品'
  return `${name}为 VIP 优先购商品，升级 VIP 收藏家或成为艺术顾问后可购买`
}

async function assertCartVipEarlyAccess(userId, goodsMap, normalizedCartItems) {
  for (const item of normalizedCartItems || []) {
    const itemKey = item.type === 'right'
      ? `right_${item.right_id}`
      : item.type === 'artwork'
        ? `artwork_${item.artwork_id}`
        : `digital_${item.digital_artwork_id}`
    const goods = goodsMap.get(itemKey)
    if (!goods || !isVipEarlyAccessActive(goods)) continue

    const allowed = await canUserBypassVipEarlyAccess(userId)
    if (!allowed) {
      return { error: buildVipEarlyAccessError(goods.title) }
    }
  }
  return { ok: true }
}

function resolveProductTable(productType) {
  const map = {
    right: 'rights',
    artwork: 'original_artworks',
    digital: 'digital_artworks',
  }
  return map[productType] || null
}

async function setProductVipEarlyAccess({
  productType,
  productId,
  enabled,
  until = null,
}) {
  await ensureVipEarlyAccessSchema()

  const table = resolveProductTable(productType)
  const id = parseInt(productId, 10)
  if (!table || !Number.isFinite(id) || id <= 0) {
    return adminResult(400, { error: '无效的商品类型或 ID' })
  }

  const flag = enabled === true || enabled === 1 || enabled === '1' ? 1 : 0
  let untilValue = null
  if (until) {
    const parsed = new Date(until)
    if (Number.isNaN(parsed.getTime())) {
      return adminResult(400, { error: '无效的截止时间' })
    }
    untilValue = parsed
  }

  const [result] = await db.query(
    `UPDATE ${table}
     SET vip_early_access = ?, vip_early_until = ?, updated_at = NOW()
     WHERE id = ?`,
    [flag, untilValue, id]
  )

  if (!result || result.affectedRows !== 1) {
    return adminResult(404, { error: '商品不存在' })
  }

  logger.info('vip early access updated', { productType, productId: id, enabled: flag, until: untilValue })
  return adminResult(200, {
    success: true,
    product_type: productType,
    product_id: id,
    vip_early_access: flag === 1,
    vip_early_until: untilValue,
  })
}

async function getProductVipEarlyAccess(productType, productId) {
  await ensureVipEarlyAccessSchema()
  const table = resolveProductTable(productType)
  const id = parseInt(productId, 10)
  if (!table || !Number.isFinite(id) || id <= 0) {
    return adminResult(400, { error: '无效的商品类型或 ID' })
  }

  const [rows] = await db.query(
    `SELECT id, title, vip_early_access, vip_early_until FROM ${table} WHERE id = ? LIMIT 1`,
    [id]
  )
  const row = rows[0]
  if (!row) return adminResult(404, { error: '商品不存在' })

  return adminResult(200, {
    product_type: productType,
    product_id: row.id,
    title: row.title,
    vip_early_access: Number(row.vip_early_access) === 1,
    vip_early_until: row.vip_early_until,
  })
}

function extendGoodsSelectColumns(baseSql) {
  return `${baseSql}, vip_early_access, vip_early_until`
}

module.exports = {
  adminResult,
  isVipTier,
  isVipEarlyAccessActive,
  canUserBypassVipEarlyAccess,
  assertCartVipEarlyAccess,
  setProductVipEarlyAccess,
  getProductVipEarlyAccess,
  PRODUCT_TABLES,
}
