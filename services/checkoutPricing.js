const crypto = require('crypto')
const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const {
  parseDigitalArtworkId,
  fetchDigitalArtworksByIds,
  hasEnoughDigitalStock,
  isDigitalArtworkPurchasable,
  ensureDigitalArtworkIdColumns,
} = require('../utils/digitalArtworkResolver')
const { parseMoney, buildRightDiscountPricingByUser } = require('../utils/rightDiscountPricing')
const { processImageUrl } = require('../utils/image')
const { ensureRightsShippingColumns } = require('./rightsService')
const {
  resolveArtworkShippingGoods,
  resolveArtworkHeightCmForVolume,
  ensureArtworksShippingColumns,
  normalizePhysicalOrderItemForShipping,
} = require('../utils/artworkShippingDimensions')
const {
  assertSfConfig,
  resolvePayAndMonthlyCard,
  queryDeliverTm: sfQueryDeliverTm,
} = require('./sfExpressClient')
const {
  buildQueryDeliverTmPayload,
  assessQueryDeliverTmResponse,
  normalizeAddress,
} = require('./sfExpressQueryDeliverTm')

const VALID_CART_ITEM_TYPES = ['right', 'digital', 'artwork']
const MAX_CART_ITEM_QUANTITY = 99
const QUOTE_REDIS_PREFIX = 'pay:checkout:quote:'
const QUOTE_TTL_SEC = parseInt(process.env.CHECKOUT_QUOTE_TTL_SEC || '900', 10)
const AMOUNT_EPSILON = 0.01

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function roundYuan(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) return 0
  return Math.round(num * 100) / 100
}

function parseOrderItemQuantity(raw) {
  const qty = parseInt(raw, 10)
  if (Number.isNaN(qty) || qty <= 0 || qty > MAX_CART_ITEM_QUANTITY) return null
  return qty
}

function normalizeCartItemShape(rawItem) {
  if (!rawItem || typeof rawItem !== 'object') return { error: '购物车商品格式无效' }
  if (!VALID_CART_ITEM_TYPES.includes(rawItem.type)) return { error: '购物车商品 type 无效' }

  const quantity = parseOrderItemQuantity(rawItem.quantity)
  if (!quantity) return { error: '购物车商品数量必须在 1-99 之间' }

  if (rawItem.type === 'right') {
    const rightId = parseInt(rawItem.right_id, 10)
    if (Number.isNaN(rightId) || rightId <= 0) return { error: '缺少有效的商品ID' }
    return { type: 'right', quantity, right_id: rightId }
  }

  if (rawItem.type === 'artwork') {
    const artworkId = parseInt(rawItem.artwork_id, 10)
    if (Number.isNaN(artworkId) || artworkId <= 0) return { error: '缺少有效的艺术品ID' }
    return { type: 'artwork', quantity, artwork_id: artworkId }
  }

  const parsedDigital = parseDigitalArtworkId(rawItem.digital_artwork_id)
  if (parsedDigital.error) return { error: parsedDigital.error }
  return { type: 'digital', quantity, digital_artwork_id: parsedDigital.id }
}

function normalizeSingleItemFromBody(body) {
  const { type, quantity, right_id, digital_artwork_id, artwork_id } = body || {}
  if (!type || !VALID_CART_ITEM_TYPES.includes(type)) {
    return { error: 'type 必须是 right、digital 或 artwork' }
  }

  const cleanQuantity = parseOrderItemQuantity(quantity)
  if (!cleanQuantity) return { error: '缺少有效的商品数量' }

  if (type === 'right') {
    const rightId = parseInt(right_id, 10)
    if (Number.isNaN(rightId) || rightId <= 0) return { error: '缺少有效的商品ID' }
    return { type: 'right', quantity: cleanQuantity, right_id: rightId }
  }

  if (type === 'artwork') {
    const artworkId = parseInt(artwork_id, 10)
    if (Number.isNaN(artworkId) || artworkId <= 0) return { error: '缺少有效的艺术品ID' }
    return { type: 'artwork', quantity: cleanQuantity, artwork_id: artworkId }
  }

  const parsedDigital = parseDigitalArtworkId(digital_artwork_id)
  if (parsedDigital.error) return { error: parsedDigital.error }
  return { type: 'digital', quantity: cleanQuantity, digital_artwork_id: parsedDigital.id }
}

function computeArtworkUnitPriceYuan(goods) {
  const originalPrice = parseMoney(goods.original_price)
  const discountPrice = parseMoney(goods.discount_price)
  if (discountPrice > 0 && discountPrice < originalPrice) return discountPrice
  return originalPrice
}

function computeDigitalUnitPriceYuan(goods) {
  return parseMoney(goods.price)
}

function hasPhysicalItems(items) {
  return (items || []).some((item) => item.type === 'right' || item.type === 'artwork')
}

function cartItemsFingerprint(items) {
  const sorted = [...(items || [])].sort((a, b) => {
    const keyA = `${a.type}:${a.right_id || a.artwork_id || a.digital_artwork_id}:${a.quantity}`
    const keyB = `${b.type}:${b.right_id || b.artwork_id || b.digital_artwork_id}:${b.quantity}`
    return keyA.localeCompare(keyB)
  })
  return JSON.stringify(sorted)
}

function amountsMatch(a, b) {
  return Math.abs(roundYuan(a) - roundYuan(b)) <= AMOUNT_EPSILON
}

function getSenderAddressFromEnv() {
  return normalizeAddress({
    province: process.env.SF_SENDER_PROVINCE,
    city: process.env.SF_SENDER_CITY,
    district: process.env.SF_SENDER_DISTRICT,
    address: process.env.SF_SENDER_ADDRESS,
  })
}

function getDefaultExpressTypeId() {
  const raw = process.env.SF_DEFAULT_EXPRESS_TYPE_ID
  const parsed = parseInt(raw, 10)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 2
}

function getDefaultPackageWeightKg() {
  const raw = process.env.SF_DEFAULT_PACKAGE_WEIGHT_KG
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 1
}

function parsePositiveShippingNumber(raw) {
  if (raw == null || raw === '') return null
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0) return null
  return num
}

function roundShippingWeightKg(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return getDefaultPackageWeightKg()
  return Math.round(num * 1000) / 1000
}

function roundShippingVolumeCm3(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return null
  return Math.round(num * 100) / 100
}

function computeItemShippingMetrics(item, goods) {
  const quantity = item.quantity || 1
  const defaultWeightKg = getDefaultPackageWeightKg()
  const unitWeightKg = parsePositiveShippingNumber(goods?.weight_kg) ?? defaultWeightKg

  let lengthCm = parsePositiveShippingNumber(goods?.length_cm)
  let widthCm = parsePositiveShippingNumber(goods?.width_cm)
  let heightCm = parsePositiveShippingNumber(goods?.height_cm)

  if (item.type === 'artwork') {
    const resolved = resolveArtworkHeightCmForVolume(goods)
    lengthCm = resolved.lengthCm
    widthCm = resolved.widthCm
    heightCm = resolved.heightCm
  }

  const unitVolumeCm3 = lengthCm && widthCm && heightCm ? lengthCm * widthCm * heightCm : null

  return {
    weightKg: unitWeightKg * quantity,
    volumeCm3: unitVolumeCm3 != null ? unitVolumeCm3 * quantity : null,
  }
}

function computeCartShippingMetrics(normalizedCartItems, goodsMap) {
  let totalWeightKg = 0
  let totalVolumeCm3 = 0
  let hasVolume = false

  for (const item of normalizedCartItems || []) {
    if (item.type !== 'right' && item.type !== 'artwork') continue

    const itemKey = item.type === 'right'
      ? `right_${item.right_id}`
      : `artwork_${item.artwork_id}`
    const goods = goodsMap.get(itemKey)
    const metrics = computeItemShippingMetrics(item, goods)
    totalWeightKg += metrics.weightKg
    if (metrics.volumeCm3 != null) {
      totalVolumeCm3 += metrics.volumeCm3
      hasVolume = true
    }
  }

  if (totalWeightKg <= 0) totalWeightKg = getDefaultPackageWeightKg()

  return {
    weightKg: roundShippingWeightKg(totalWeightKg),
    volumeCm3: hasVolume && totalVolumeCm3 > 0 ? roundShippingVolumeCm3(totalVolumeCm3) : null,
  }
}

function resolvePackageDimensionsFromPhysicalItems(physicalItems) {
  const shippableRows = (physicalItems || []).filter((row) => row.type === 'right' || row.type === 'artwork')
  if (shippableRows.length !== 1) {
    return { totalLength: null, totalWidth: null, totalHeight: null }
  }

  const row = normalizePhysicalOrderItemForShipping(shippableRows[0])
  const resolved = row.type === 'artwork'
    ? resolveArtworkHeightCmForVolume(row)
    : {
      lengthCm: parsePositiveShippingNumber(row.length_cm),
      widthCm: parsePositiveShippingNumber(row.width_cm),
      heightCm: parsePositiveShippingNumber(row.height_cm),
    }

  if (!resolved.lengthCm || !resolved.widthCm || !resolved.heightCm) {
    return { totalLength: null, totalWidth: null, totalHeight: null }
  }

  return {
    totalLength: resolved.lengthCm,
    totalWidth: resolved.widthCm,
    totalHeight: resolved.heightCm,
  }
}

function buildShippingMetricsFromPhysicalItems(physicalItems) {
  const normalizedCartItems = []
  const goodsMap = new Map()

  for (const rawRow of physicalItems || []) {
    const row = normalizePhysicalOrderItemForShipping(rawRow)
    const quantity = Number(row.quantity) > 0 ? Number(row.quantity) : 1
    if (row.type === 'right' && row.right_id) {
      normalizedCartItems.push({ type: 'right', right_id: row.right_id, quantity })
      goodsMap.set(`right_${row.right_id}`, {
        weight_kg: row.weight_kg,
        length_cm: row.length_cm,
        width_cm: row.width_cm,
        height_cm: row.height_cm,
      })
    } else if (row.type === 'artwork' && row.artwork_id) {
      normalizedCartItems.push({ type: 'artwork', artwork_id: row.artwork_id, quantity })
      goodsMap.set(`artwork_${row.artwork_id}`, {
        weight_kg: row.weight_kg,
        length_cm: row.length_cm,
        width_cm: row.width_cm,
        height_cm: row.height_cm,
      })
    }
  }

  const aggregated = computeCartShippingMetrics(normalizedCartItems, goodsMap)
  const dimensions = resolvePackageDimensionsFromPhysicalItems(physicalItems)

  return {
    totalWeight: aggregated.weightKg,
    totalVolume: aggregated.volumeCm3,
    ...dimensions,
  }
}

function applyShippingMetricsOverrides(metrics, overrides = {}) {
  const result = {
    totalWeight: metrics?.totalWeight ?? null,
    totalVolume: metrics?.totalVolume ?? null,
    totalLength: metrics?.totalLength ?? null,
    totalWidth: metrics?.totalWidth ?? null,
    totalHeight: metrics?.totalHeight ?? null,
  }

  const mapping = [
    ['total_weight', 'totalWeight'],
    ['total_volume', 'totalVolume'],
    ['total_length', 'totalLength'],
    ['total_width', 'totalWidth'],
    ['total_height', 'totalHeight'],
  ]

  for (const [bodyKey, resultKey] of mapping) {
    const parsed = parsePositiveShippingNumber(overrides[bodyKey])
    if (parsed != null) result[resultKey] = parsed
  }

  return result
}

function getFallbackShippingYuan() {
  const raw = process.env.SF_CHECKOUT_FALLBACK_SHIPPING_YUAN
  if (raw == null || String(raw).trim() === '') return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return roundYuan(parsed)
}

function parseExpressTypeId(raw) {
  if (raw == null || raw === '') return getDefaultExpressTypeId()
  const parsed = parseInt(raw, 10)
  if (Number.isNaN(parsed) || parsed <= 0) return null
  return parsed
}

async function getAvailableDiscount(connection, userId) {
  const [discounts] = await connection.query(`
    SELECT COALESCE(SUM(dip.discount_amount), 0) as total_discount
    FROM digital_identity_purchases dip
    WHERE dip.user_id = ? AND dip.discount_amount > 0
  `, [userId])
  return roundYuan(discounts[0]?.total_discount || 0)
}

async function loadBuyerAddressRow(connection, userId, addressId) {
  const parsedId = parseInt(addressId, 10)
  if (Number.isNaN(parsedId) || parsedId <= 0) return null

  const [rows] = await connection.query(
    `SELECT id, province, city, district, detail_address, receiver_name, receiver_phone
     FROM wx_user_addresses
     WHERE id = ? AND user_id = ?
     LIMIT 1`,
    [parsedId, userId]
  )
  return rows[0] || null
}

function composeAddressLine(row) {
  if (!row) return ''
  return [row.province, row.city, row.district, row.detail_address]
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join(' ')
}

function buildDestAddressFromRow(row) {
  if (!row) return null
  return normalizeAddress({
    province: row.province,
    city: row.city,
    district: row.district,
    address: row.detail_address || composeAddressLine(row),
  })
}

async function computeShippingFee({ destAddress, expressTypeId, weightKg, volumeCm3 }) {
  if (!destAddress) return { error: '缺少收货地址' }

  const srcAddress = getSenderAddressFromEnv()
  const fallbackShippingYuan = getFallbackShippingYuan()
  const auth = assertSfConfig()

  if (!auth.ok) {
    if (fallbackShippingYuan != null) {
      return {
        shippingFeeYuan: fallbackShippingYuan,
        shippingSnapshot: { provider: 'fallback', reason: auth.error },
        shippingMeta: {
          provider: 'fallback',
          express_type_id: expressTypeId,
          express_type_name: '默认运费',
        },
      }
    }
    return { error: '运费服务暂不可用，请稍后重试' }
  }

  const payInfo = resolvePayAndMonthlyCard('SF_CASH')
  const built = buildQueryDeliverTmPayload({
    srcAddress,
    destAddress,
    businessType: expressTypeId,
    weight: weightKg,
    volume: volumeCm3,
    searchPrice: '1',
    monthlyCard: payInfo.monthlyCard,
  })

  if (!built.ok) {
    if (fallbackShippingYuan != null) {
      return {
        shippingFeeYuan: fallbackShippingYuan,
        shippingSnapshot: { provider: 'fallback', reason: built.error },
        shippingMeta: {
          provider: 'fallback',
          express_type_id: expressTypeId,
          express_type_name: '默认运费',
        },
      }
    }
    return { error: built.error || '运费计算失败' }
  }

  try {
    const sfResult = await sfQueryDeliverTm(built.payload)
    if (!sfResult.ok) {
      if (fallbackShippingYuan != null) {
        return {
          shippingFeeYuan: fallbackShippingYuan,
          shippingSnapshot: { provider: 'fallback', sf_error: sfResult.error },
          shippingMeta: {
            provider: 'fallback',
            express_type_id: expressTypeId,
            express_type_name: '默认运费',
          },
        }
      }
      return { error: sfResult.error || '运费查询失败' }
    }

    const assessment = assessQueryDeliverTmResponse(sfResult.msgData)
    if (!assessment.ok) {
      if (fallbackShippingYuan != null) {
        return {
          shippingFeeYuan: fallbackShippingYuan,
          shippingSnapshot: { provider: 'fallback', reason: assessment.error },
          shippingMeta: {
            provider: 'fallback',
            express_type_id: expressTypeId,
            express_type_name: '默认运费',
          },
        }
      }
      return { error: assessment.error || '运费查询失败' }
    }

    const list = assessment.deliver_tm_list || []
    const matched = list.find((row) => String(row.business_type) === String(expressTypeId))
      || list[0]

    if (!matched || matched.fee == null || !Number.isFinite(Number(matched.fee))) {
      if (fallbackShippingYuan != null) {
        return {
          shippingFeeYuan: fallbackShippingYuan,
          shippingSnapshot: { provider: 'fallback', deliver_tm_list: list },
          shippingMeta: {
            provider: 'fallback',
            express_type_id: expressTypeId,
            express_type_name: '默认运费',
          },
        }
      }
      return { error: '未能获取有效运费，请更换地址或快递产品后重试' }
    }

    return {
      shippingFeeYuan: roundYuan(matched.fee),
      shippingSnapshot: {
        provider: 'sf-express',
        express_type_id: matched.business_type,
        deliver_tm_list: list,
      },
      shippingMeta: {
        provider: 'sf-express',
        express_type_id: Number(matched.business_type) || expressTypeId,
        express_type_name: matched.business_type_desc || undefined,
        deliver_time: matched.deliver_time || undefined,
      },
      deliverTmList: list,
    }
  } catch (err) {
    logger.error('computeShippingFee failed', { err: err?.message || err })
    if (fallbackShippingYuan != null) {
      return {
        shippingFeeYuan: fallbackShippingYuan,
        shippingSnapshot: { provider: 'fallback', detail: err.message },
        shippingMeta: {
          provider: 'fallback',
          express_type_id: expressTypeId,
          express_type_name: '默认运费',
        },
      }
    }
    return { error: '运费查询失败' }
  }
}

function buildPreviewItemImageFields(item, goods, rightImagesMap) {
  if (item.type === 'right') {
    const rawImages = rightImagesMap[item.right_id] || []
    const images = rawImages.map((url) => processImageUrl(url)).filter(Boolean)
    return {
      image: images[0] || '',
      images,
    }
  }

  if (item.type === 'artwork') {
    const image = processImageUrl(goods.image || '') || ''
    return {
      image,
      images: image ? [image] : [],
    }
  }

  if (item.type === 'digital') {
    const rawImage = goods.image_url || goods.digital_image_url || goods.image || ''
    const image = processImageUrl(rawImage) || ''
    return {
      image,
      images: image ? [image] : [],
    }
  }

  return { image: '', images: [] }
}

async function priceCartItems(connection, userId, normalizedCartItems) {
  await ensureRightsShippingColumns(connection)
  await ensureArtworksShippingColumns(connection)

  const rightIds = []
  const artworkIds = []
  const digitalIds = []

  normalizedCartItems.forEach((item) => {
    if (item.type === 'right') rightIds.push(item.right_id)
    else if (item.type === 'artwork') artworkIds.push(item.artwork_id)
    else if (item.type === 'digital') digitalIds.push(item.digital_artwork_id)
  })

  const goodsMap = new Map()
  const rightsMapForPricing = {}

  if (rightIds.length > 0) {
    const [rights] = await connection.query(
      `SELECT id, title, price, discount_price, remaining_count,
              length_cm, width_cm, height_cm, weight_kg
       FROM rights WHERE id IN (?) AND status = "onsale"`,
      [rightIds]
    )
    rights.forEach((right) => {
      goodsMap.set(`right_${right.id}`, right)
      rightsMapForPricing[right.id] = right
    })
  }

  const rightDiscountPricing = await buildRightDiscountPricingByUser(userId, rightsMapForPricing)

  const rightImagesMap = {}
  if (rightIds.length > 0) {
    const [rightImages] = await connection.query(
      'SELECT right_id, image_url FROM right_images WHERE right_id IN (?) ORDER BY id',
      [rightIds]
    )
    ;(rightImages || []).forEach((row) => {
      if (!rightImagesMap[row.right_id]) rightImagesMap[row.right_id] = []
      if (row.image_url) rightImagesMap[row.right_id].push(row.image_url)
    })
  }

  if (artworkIds.length > 0) {
    const [artworks] = await connection.query(
      `SELECT oa.id, oa.title, oa.image, oa.original_price, oa.discount_price, oa.stock,
              oa.collection_size, oa.length_cm, oa.width_cm, oa.height_cm, oa.weight_kg
       FROM original_artworks oa
       INNER JOIN artists a ON a.id = oa.artist_id
       WHERE oa.id IN (?) AND oa.is_on_sale = 1
         AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1`,
      [artworkIds]
    )
    artworks.forEach((artwork) => {
      goodsMap.set(`artwork_${artwork.id}`, {
        ...artwork,
        ...resolveArtworkShippingGoods(artwork),
      })
    })
  }

  if (digitalIds.length > 0) {
    const digitalsMap = await fetchDigitalArtworksByIds(digitalIds, connection)
    digitalsMap.forEach((digital, id) => {
      goodsMap.set(`digital_${id}`, digital)
    })
  }

  let itemsSubtotalYuan = 0
  const pricedCartItems = []
  const previewItems = []

  for (const item of normalizedCartItems) {
    const itemKey = item.type === 'right'
      ? `right_${item.right_id}`
      : item.type === 'artwork'
        ? `artwork_${item.artwork_id}`
        : `digital_${item.digital_artwork_id}`
    const goods = goodsMap.get(itemKey)
    const itemId = item.type === 'right'
      ? item.right_id
      : item.type === 'artwork'
        ? item.artwork_id
        : item.digital_artwork_id

    if (!goods) {
      return { error: adminResult(404, { error: `商品ID ${itemId} 不存在或已下架` }) }
    }

    if (item.type === 'digital' && !isDigitalArtworkPurchasable(goods)) {
      return { error: adminResult(404, { error: `数字艺术品ID ${item.digital_artwork_id} 不存在或已下架` }) }
    }

    if (item.type === 'right' && goods.remaining_count < item.quantity) {
      return { error: adminResult(400, { error: `商品ID ${item.right_id} 库存不足` }) }
    }
    if (item.type === 'artwork' && goods.stock < item.quantity) {
      return { error: adminResult(400, { error: `艺术品ID ${item.artwork_id} 库存不足` }) }
    }
    if (item.type === 'digital' && !hasEnoughDigitalStock(goods, item.quantity)) {
      return { error: adminResult(400, { error: `数字艺术品ID ${item.digital_artwork_id} 库存不足` }) }
    }

    let unitPriceYuan
    if (item.type === 'right') {
      const pricing = rightDiscountPricing[item.right_id]
      unitPriceYuan = pricing?.effective_price ?? parseMoney(goods.price)
    } else if (item.type === 'digital') {
      unitPriceYuan = computeDigitalUnitPriceYuan(goods)
    } else {
      unitPriceYuan = computeArtworkUnitPriceYuan(goods)
    }

    if (!Number.isFinite(unitPriceYuan) || unitPriceYuan < 0) {
      return { error: adminResult(400, { error: `商品ID ${itemId} 价格无效` }) }
    }

    const lineSubtotalYuan = roundYuan(unitPriceYuan * item.quantity)
    itemsSubtotalYuan += lineSubtotalYuan
    pricedCartItems.push({ ...item, unitPriceYuan })
    const imageFields = buildPreviewItemImageFields(item, goods, rightImagesMap)
    previewItems.push({
      type: item.type,
      id: itemId,
      title: goods.title || '',
      quantity: item.quantity,
      unit_price_yuan: roundYuan(unitPriceYuan),
      line_subtotal_yuan: lineSubtotalYuan,
      image: imageFields.image,
      images: imageFields.images,
    })
  }

  if (!Number.isFinite(itemsSubtotalYuan) || itemsSubtotalYuan <= 0) {
    return { error: adminResult(400, { error: '订单金额无效' }) }
  }

  return {
    pricedCartItems,
    previewItems,
    itemsSubtotalYuan: roundYuan(itemsSubtotalYuan),
    goodsMap,
  }
}

function buildFeeBreakdown({ itemsSubtotalYuan, shippingFeeYuan, discountYuan }) {
  const totalFeeYuan = roundYuan(itemsSubtotalYuan + shippingFeeYuan)
  const amountPayableYuan = roundYuan(Math.max(0, totalFeeYuan - discountYuan))
  return {
    currency: 'CNY',
    items_subtotal_yuan: itemsSubtotalYuan,
    shipping_fee_yuan: shippingFeeYuan,
    discount_yuan: discountYuan,
    amount_payable_yuan: amountPayableYuan,
    order_total_before_discount_yuan: totalFeeYuan,
  }
}

function parseCheckoutPreviewBody(body) {
  const payload = body && typeof body === 'object' ? body : {}
  const mode = payload.mode === 'single' ? 'single' : 'cart'
  const expressTypeId = parseExpressTypeId(payload.express_type_id)
  if (expressTypeId == null) return { error: 'express_type_id 无效' }

  let normalizedCartItems = []
  if (mode === 'single') {
    const single = normalizeSingleItemFromBody(payload)
    if (single.error) return { error: single.error }
    normalizedCartItems = [single]
  } else {
    const cartItems = payload.cart_items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return { error: '缺少有效的购物车商品' }
    }
    if (cartItems.length > 20) return { error: '购物车商品数量不能超过20个' }
    for (const rawItem of cartItems) {
      const normalized = normalizeCartItemShape(rawItem)
      if (normalized.error) return { error: normalized.error }
      normalizedCartItems.push(normalized)
    }
  }

  return {
    mode,
    normalizedCartItems,
    addressId: payload.address_id,
    expressTypeId,
  }
}

async function buildCheckoutQuote({ connection, userId, mode, normalizedCartItems, addressId, expressTypeId }) {
  const priced = await priceCartItems(connection, userId, normalizedCartItems)
  if (priced.error) return priced

  const physical = hasPhysicalItems(normalizedCartItems)
  let resolvedAddressId = null
  let destAddress = null

  if (physical) {
    if (!addressId) {
      return { error: adminResult(400, { error: '实物商品须选择收货地址' }) }
    }
    const addressRow = await loadBuyerAddressRow(connection, userId, addressId)
    if (!addressRow) {
      return { error: adminResult(403, { error: '收货地址不属于当前用户' }) }
    }
    resolvedAddressId = addressRow.id
    destAddress = buildDestAddressFromRow(addressRow)
    if (!destAddress?.province && !destAddress?.city && !destAddress?.address) {
      return { error: adminResult(400, { error: '收货地址不完整，无法计算运费' }) }
    }
  }

  let shippingFeeYuan = 0
  let shippingSnapshot = null
  let shippingMeta = null
  let deliverTmList = []

  if (physical) {
    const shippingMetrics = computeCartShippingMetrics(normalizedCartItems, priced.goodsMap)
    const shipping = await computeShippingFee({
      destAddress,
      expressTypeId,
      weightKg: shippingMetrics.weightKg,
      volumeCm3: shippingMetrics.volumeCm3,
    })
    if (shipping.error) {
      return { error: adminResult(400, { error: shipping.error }) }
    }
    shippingFeeYuan = shipping.shippingFeeYuan
    shippingSnapshot = shipping.shippingSnapshot
    shippingMeta = shipping.shippingMeta
    deliverTmList = shipping.deliverTmList || []
  }

  const discountYuan = await getAvailableDiscount(connection, userId)
  const fee = buildFeeBreakdown({
    itemsSubtotalYuan: priced.itemsSubtotalYuan,
    shippingFeeYuan,
    discountYuan,
  })

  return {
    data: {
      mode,
      has_physical_items: physical,
      requires_address: physical,
      address_id: resolvedAddressId,
      express_type_id: expressTypeId,
      items: priced.previewItems,
      fee,
      shipping: shippingMeta,
      deliver_tm_list: deliverTmList,
      normalized_cart_items: normalizedCartItems,
      priced_cart_items: priced.pricedCartItems,
      items_subtotal_yuan: priced.itemsSubtotalYuan,
      shipping_fee_yuan: shippingFeeYuan,
      discount_yuan: discountYuan,
      total_fee_yuan: fee.order_total_before_discount_yuan,
      amount_payable_yuan: fee.amount_payable_yuan,
      shipping_snapshot: shippingSnapshot,
      cart_fingerprint: cartItemsFingerprint(normalizedCartItems),
    },
  }
}

function buildQuoteRedisKey(token) {
  return `${QUOTE_REDIS_PREFIX}${token}`
}

async function saveCheckoutQuote(userId, quoteData) {
  const token = `qt_${crypto.randomBytes(16).toString('hex')}`
  const payload = {
    user_id: userId,
    created_at: Date.now(),
    ...quoteData,
  }
  await redisClient.setEx(buildQuoteRedisKey(token), QUOTE_TTL_SEC, JSON.stringify(payload))
  return { token, expiresIn: QUOTE_TTL_SEC }
}

async function loadCheckoutQuote(userId, quoteToken) {
  const cleanToken = typeof quoteToken === 'string' ? quoteToken.trim() : ''
  if (!cleanToken) return { error: adminResult(400, { error: '缺少有效的 quote_token' }) }

  const raw = await redisClient.get(buildQuoteRedisKey(cleanToken))
  if (!raw) {
    return { error: adminResult(409, { error: '结算报价已过期，请重新选择地址并预览' }) }
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { error: adminResult(409, { error: '结算报价无效，请重新预览' }) }
  }

  if (Number(parsed.user_id) !== Number(userId)) {
    return { error: adminResult(403, { error: '结算报价与当前用户不匹配' }) }
  }

  return { quote: parsed, token: cleanToken }
}

async function deleteCheckoutQuote(token) {
  if (!token) return
  await redisClient.del(buildQuoteRedisKey(token))
}

async function resolveCheckoutAmounts({
  connection,
  userId,
  normalizedCartItems,
  addressId,
  quoteToken,
  expressTypeId,
}) {
  if (quoteToken) {
    const loaded = await loadCheckoutQuote(userId, quoteToken)
    if (loaded.error) return loaded

    const quote = loaded.quote
    if (cartItemsFingerprint(normalizedCartItems) !== quote.cart_fingerprint) {
      return { error: adminResult(409, { error: '商品信息已变更，请重新预览后再支付' }) }
    }

    if (hasPhysicalItems(normalizedCartItems)) {
      const parsedAddressId = parseInt(addressId, 10)
      if (Number.isNaN(parsedAddressId) || parsedAddressId <= 0) {
        return { error: adminResult(400, { error: '实物商品须选择收货地址' }) }
      }
      if (Number(quote.address_id) !== parsedAddressId) {
        return { error: adminResult(409, { error: '收货地址已变更，请重新预览后再支付' }) }
      }
    }

    const repriced = await buildCheckoutQuote({
      connection,
      userId,
      mode: quote.mode || 'cart',
      normalizedCartItems,
      addressId: quote.address_id,
      expressTypeId: quote.express_type_id || expressTypeId || getDefaultExpressTypeId(),
    })
    if (repriced.error) return repriced

    const fresh = repriced.data
    if (!amountsMatch(fresh.amount_payable_yuan, quote.amount_payable_yuan)
      || !amountsMatch(fresh.shipping_fee_yuan, quote.shipping_fee_yuan)
      || !amountsMatch(fresh.items_subtotal_yuan, quote.items_subtotal_yuan)) {
      return { error: adminResult(409, { error: '商品价格或运费已变更，请重新预览后再支付' }) }
    }

    return {
      pricedCartItems: fresh.priced_cart_items,
      itemsSubtotalYuan: fresh.items_subtotal_yuan,
      shippingFeeYuan: fresh.shipping_fee_yuan,
      discountYuan: fresh.discount_yuan,
      totalFeeYuan: fresh.total_fee_yuan,
      actualTotalFee: fresh.amount_payable_yuan,
      expressTypeId: fresh.express_type_id,
      shippingSnapshot: fresh.shipping_snapshot,
      resolvedAddressId: fresh.address_id,
      quoteToken: loaded.token,
    }
  }

  const priced = await priceCartItems(connection, userId, normalizedCartItems)
  if (priced.error) return priced

  const physical = hasPhysicalItems(normalizedCartItems)
  let resolvedAddressId = null
  if (physical && addressId) {
    const addressRow = await loadBuyerAddressRow(connection, userId, addressId)
    if (!addressRow) {
      return { error: adminResult(403, { error: '收货地址不属于当前用户' }) }
    }
    resolvedAddressId = addressRow.id
  }

  const discountYuan = await getAvailableDiscount(connection, userId)
  const itemsSubtotalYuan = priced.itemsSubtotalYuan
  const shippingFeeYuan = 0
  const totalFeeYuan = roundYuan(itemsSubtotalYuan + shippingFeeYuan)
  const actualTotalFee = roundYuan(Math.max(0, totalFeeYuan - discountYuan))

  return {
    pricedCartItems: priced.pricedCartItems,
    itemsSubtotalYuan,
    shippingFeeYuan,
    discountYuan,
    totalFeeYuan,
    actualTotalFee,
    expressTypeId: null,
    shippingSnapshot: null,
    resolvedAddressId,
    quoteToken: null,
  }
}

async function checkoutPreview(req) {
  try {
    await ensureDigitalArtworkIdColumns()

    const userId = Number(req.user?.id)
    if (!userId || Number.isNaN(userId)) {
      return adminResult(401, { error: '请先登录' })
    }

    const parsed = parseCheckoutPreviewBody(req.body)
    if (parsed.error) return adminResult(400, { error: parsed.error })

    const connection = await db.getConnection()
    try {
      const quote = await buildCheckoutQuote({
        connection,
        userId,
        mode: parsed.mode,
        normalizedCartItems: parsed.normalizedCartItems,
        addressId: parsed.addressId,
        expressTypeId: parsed.expressTypeId,
      })
      if (quote.error) return quote.error

      const saved = await saveCheckoutQuote(userId, quote.data)
      const { normalized_cart_items, priced_cart_items, cart_fingerprint, shipping_snapshot, ...publicData } = quote.data

      return adminResult(200, {
        success: true,
        data: {
          ...publicData,
          quote_token: saved.token,
          expires_in: saved.expiresIn,
        },
      })
    } finally {
      connection.release()
    }
  } catch (error) {
    logger.error('结算预览失败', { err: error })
    return adminResult(500, { error: '结算预览失败' })
  }
}

module.exports = {
  VALID_CART_ITEM_TYPES,
  MAX_CART_ITEM_QUANTITY,
  parseOrderItemQuantity,
  normalizeCartItemShape,
  normalizeSingleItemFromBody,
  computeArtworkUnitPriceYuan,
  computeDigitalUnitPriceYuan,
  hasPhysicalItems,
  roundYuan,
  amountsMatch,
  cartItemsFingerprint,
  parseCheckoutPreviewBody,
  priceCartItems,
  buildCheckoutQuote,
  resolveCheckoutAmounts,
  saveCheckoutQuote,
  loadCheckoutQuote,
  deleteCheckoutQuote,
  checkoutPreview,
  buildFeeBreakdown,
  getDefaultExpressTypeId,
  getDefaultPackageWeightKg,
  computeCartShippingMetrics,
  computeItemShippingMetrics,
  buildShippingMetricsFromPhysicalItems,
  applyShippingMetricsOverrides,
  buildPreviewItemImageFields,
}
