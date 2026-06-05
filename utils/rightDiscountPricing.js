const db = require('../db')

function parseMoney(raw) {
  const n = parseFloat(raw)
  return Number.isFinite(n) ? n : 0
}

/** 批量计算实物权益优惠价资格（与下单、购物车逻辑一致） */
async function buildRightDiscountPricingByUser(userId, rightsMap) {
  const rightIds = Object.keys(rightsMap)
    .map((id) => parseInt(id, 10))
    .filter((id) => !Number.isNaN(id) && id > 0)

  if (!rightIds.length || !userId) return {}

  const [eligibleRows] = await db.query(
    'SELECT right_id, digital_artwork_id FROM right_discount_eligibles WHERE right_id IN (?)',
    [rightIds]
  )

  const eligiblesByRight = {}
  const allEligibleDigitalIds = new Set()

  for (const row of eligibleRows || []) {
    const rid = row.right_id
    const digitalId = String(row.digital_artwork_id)
    if (!eligiblesByRight[rid]) eligiblesByRight[rid] = []
    eligiblesByRight[rid].push(digitalId)
    allEligibleDigitalIds.add(digitalId)
  }

  let ownedDigitalIds = new Set()
  if (allEligibleDigitalIds.size > 0) {
    const [ownedRows] = await db.query(
      'SELECT digital_artwork_id FROM digital_identity_purchases WHERE user_id = ? AND digital_artwork_id IN (?)',
      [userId, [...allEligibleDigitalIds]]
    )
    ownedDigitalIds = new Set((ownedRows || []).map((row) => String(row.digital_artwork_id)))
  }

  const pricingByRight = {}
  for (const rid of rightIds) {
    const right = rightsMap[rid]
    const eligibleIds = eligiblesByRight[rid] || []
    const listPrice = parseMoney(right?.price)
    const discountPrice = parseMoney(right?.discount_price)
    const hasDiscount = discountPrice > 0
    const ownedEligibleIds = eligibleIds.filter((id) => ownedDigitalIds.has(id))
    const discountEligible = hasDiscount && eligibleIds.length > 0 && ownedEligibleIds.length > 0

    pricingByRight[rid] = {
      eligible_digital_artwork_ids: eligibleIds,
      owned_eligible_digital_artwork_ids: ownedEligibleIds,
      has_discount: hasDiscount,
      discount_eligible: discountEligible,
      effective_price: discountEligible ? discountPrice : listPrice,
    }
  }

  return pricingByRight
}

module.exports = {
  parseMoney,
  buildRightDiscountPricingByUser,
}
