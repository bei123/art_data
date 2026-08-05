const db = require('../db')
const logger = require('./logger')
const { ensureOrderInventoryReservedColumn } = require('./ordersSchema')
const {
  adjustDigitalArtworkStock,
} = require('./digitalArtworkResolver')

class InventoryReserveError extends Error {
  constructor(message, meta = {}) {
    super(message)
    this.name = 'InventoryReserveError'
    this.code = 'INVENTORY_RESERVE_FAILED'
    this.meta = meta
  }
}

function queryWithConnection(connection, sql, params) {
  if (connection && typeof connection.query === 'function') {
    return connection.query(sql, params)
  }
  return db.query(sql, params)
}

function buildReserveBoostFromItems(items) {
  const boost = { rights: {}, artworks: {}, digitals: {} }
  for (const item of items || []) {
    const qty = Number(item.quantity) || 0
    if (qty <= 0) continue
    if (item.type === 'right' && item.right_id) {
      boost.rights[item.right_id] = (boost.rights[item.right_id] || 0) + qty
    } else if (item.type === 'artwork' && item.artwork_id) {
      boost.artworks[item.artwork_id] = (boost.artworks[item.artwork_id] || 0) + qty
    } else if (item.type === 'digital' && item.digital_artwork_id) {
      boost.digitals[String(item.digital_artwork_id)] = (boost.digitals[String(item.digital_artwork_id)] || 0) + qty
    }
  }
  return boost
}

function cartItemReserveKey(item) {
  if (!item || !item.type) return null
  if (item.type === 'right' && item.right_id) return `right:${item.right_id}`
  if (item.type === 'artwork' && item.artwork_id) return `artwork:${item.artwork_id}`
  if (item.type === 'digital' && item.digital_artwork_id != null) {
    return `digital:${String(item.digital_artwork_id)}`
  }
  return null
}

function cartItemsOverlap(orderItems, cartItems) {
  const cartKeys = new Set((cartItems || []).map(cartItemReserveKey).filter(Boolean))
  if (!cartKeys.size) return false
  return (orderItems || []).some((item) => cartKeys.has(cartItemReserveKey(item)))
}

async function loadUserPendingReserveBoostForCart(connection, userId, normalizedCartItems) {
  const empty = buildReserveBoostFromItems([])
  if (!userId || !Array.isArray(normalizedCartItems) || !normalizedCartItems.length) return empty

  await ensureOrderInventoryReservedColumn()

  const [rows] = await queryWithConnection(
    connection,
    `SELECT oi.type, oi.quantity, oi.right_id, oi.artwork_id, oi.digital_artwork_id
     FROM order_items oi
     INNER JOIN orders o ON o.id = oi.order_id
     WHERE o.user_id = ?
       AND o.trade_state IN ('NOTPAY', 'PAYERROR')
       AND o.inventory_reserved = 1`,
    [userId]
  )
  if (!rows?.length) return empty

  const cartKeys = new Set(normalizedCartItems.map(cartItemReserveKey).filter(Boolean))
  const overlapping = rows.filter((item) => cartKeys.has(cartItemReserveKey(item)))
  return buildReserveBoostFromItems(overlapping)
}

async function loadCheckoutReserveBoost(connection, userId, normalizedCartItems, reserveOrderId = null) {
  const orderBoost = await loadOrderInventoryReserveBoost(connection, reserveOrderId)
  if (reserveOrderId) return orderBoost
  return loadUserPendingReserveBoostForCart(connection, userId, normalizedCartItems)
}

async function releaseOverlappingUserPendingInventory({
  connection,
  userId,
  cartItems,
  excludeOrderId = null,
}) {
  await ensureOrderInventoryReservedColumn()

  const affected = { rightIds: [], artworkIds: [], digitalIds: [] }
  if (!userId || !Array.isArray(cartItems) || !cartItems.length) {
    return affected
  }

  const sql = excludeOrderId
    ? `SELECT id FROM orders
       WHERE user_id = ?
         AND trade_state IN ('NOTPAY', 'PAYERROR')
         AND inventory_reserved = 1
         AND id != ?`
    : `SELECT id FROM orders
       WHERE user_id = ?
         AND trade_state IN ('NOTPAY', 'PAYERROR')
         AND inventory_reserved = 1`
  const params = excludeOrderId ? [userId, excludeOrderId] : [userId]
  const [orders] = await queryWithConnection(connection, sql, params)

  for (const order of orders || []) {
    const items = await loadOrderItemsByOrderId(order.id, connection)
    if (!cartItemsOverlap(items, cartItems)) continue

    const released = await releaseOrderInventoryIfReserved(order.id, connection)
    if (!released.released) continue

    // 重叠预扣释放后必须关掉旧未支付单，否则可再支付导致二次扣库存
    await queryWithConnection(
      connection,
      `UPDATE orders
       SET trade_state = 'CLOSED',
           trade_state_desc = '因重复下单释放库存预扣而关闭',
           updated_at = NOW()
       WHERE id = ? AND trade_state IN ('NOTPAY', 'PAYERROR')`,
      [order.id]
    )

    affected.rightIds.push(...(released.affected.rightIds || []))
    affected.artworkIds.push(...(released.affected.artworkIds || []))
    affected.digitalIds.push(...(released.affected.digitalIds || []))
    logger.info('released overlapping pending order inventory', {
      userId,
      orderId: order.id,
      excludeOrderId,
    })
  }

  return affected
}

async function loadOrderItemsByOrderId(orderId, connection = null) {
  if (!orderId) return []
  const [rows] = await queryWithConnection(
    connection,
    `SELECT order_id, type, quantity, right_id, artwork_id, digital_artwork_id
     FROM order_items WHERE order_id = ?`,
    [orderId]
  )
  return rows || []
}

async function loadOrderInventoryReserveBoost(connection, orderId) {
  const empty = buildReserveBoostFromItems([])
  if (!orderId) return empty

  await ensureOrderInventoryReservedColumn()

  const [[order]] = await queryWithConnection(
    connection,
    'SELECT inventory_reserved FROM orders WHERE id = ? LIMIT 1',
    [orderId]
  )
  if (Number(order?.inventory_reserved) !== 1) return empty

  const items = await loadOrderItemsByOrderId(orderId, connection)
  return buildReserveBoostFromItems(items)
}

async function releaseOrderItemsInventory({ orderItems, connection = null }) {
  const rightIds = []
  const artworkIds = []
  const digitalIds = []

  for (const item of orderItems || []) {
    const qty = Number(item.quantity) || 0
    if (qty <= 0) continue

    if (item.type === 'right' && item.right_id) {
      await queryWithConnection(
        connection,
        'UPDATE rights SET remaining_count = remaining_count + ? WHERE id = ?',
        [qty, item.right_id]
      )
      rightIds.push(item.right_id)
      continue
    }

    if (item.type === 'artwork' && item.artwork_id) {
      await queryWithConnection(
        connection,
        'UPDATE original_artworks SET stock = stock + ? WHERE id = ?',
        [qty, item.artwork_id]
      )
      artworkIds.push(item.artwork_id)
      continue
    }

    if (item.type === 'digital' && item.digital_artwork_id) {
      await adjustDigitalArtworkStock({
        connection,
        id: item.digital_artwork_id,
        delta: qty,
      })
      digitalIds.push(item.digital_artwork_id)
    }
  }

  return { rightIds, artworkIds, digitalIds }
}

async function reserveOrderItemsInventory({ orderItems, connection = null }) {
  const rightIds = []
  const artworkIds = []
  const digitalIds = []

  for (const item of orderItems || []) {
    const qty = Number(item.quantity) || 0
    if (qty <= 0) continue

    if (item.type === 'right' && item.right_id) {
      const [result] = await queryWithConnection(
        connection,
        `UPDATE rights
         SET remaining_count = remaining_count - ?
         WHERE id = ? AND status = 'onsale' AND remaining_count >= ?`,
        [qty, item.right_id, qty]
      )
      if (!result?.affectedRows) {
        throw new InventoryReserveError('商品库存不足或已下架', {
          type: 'right',
          id: item.right_id,
        })
      }
      rightIds.push(item.right_id)
      continue
    }

    if (item.type === 'artwork' && item.artwork_id) {
      const [result] = await queryWithConnection(
        connection,
        `UPDATE original_artworks oa
         INNER JOIN artists a ON a.id = oa.artist_id
         SET oa.stock = oa.stock - ?
         WHERE oa.id = ? AND oa.is_on_sale = 1 AND oa.stock >= ?
           AND oa.is_public_eff = 1 AND a.is_public_eff = 1`,
        [qty, item.artwork_id, qty]
      )
      if (!result?.affectedRows) {
        throw new InventoryReserveError('艺术品库存不足或已下架', {
          type: 'artwork',
          id: item.artwork_id,
        })
      }
      artworkIds.push(item.artwork_id)
      continue
    }

    if (item.type === 'digital' && item.digital_artwork_id) {
      const ok = await adjustDigitalArtworkStock({
        connection,
        id: item.digital_artwork_id,
        delta: -qty,
      })
      if (!ok) {
        throw new InventoryReserveError('数字艺术品库存不足或已下架', {
          type: 'digital',
          id: item.digital_artwork_id,
        })
      }
      digitalIds.push(item.digital_artwork_id)
    }
  }

  return { rightIds, artworkIds, digitalIds }
}

async function releaseOrderInventoryIfReserved(orderId, connection = null) {
  await ensureOrderInventoryReservedColumn()

  const ownsConnection = !connection
  const runner = connection || (await db.getConnection())

  try {
    if (ownsConnection) await runner.beginTransaction()

    const [rows] = await queryWithConnection(
      runner,
      `SELECT id, inventory_reserved, inventory_state
       FROM orders WHERE id = ? LIMIT 1 FOR UPDATE`,
      [orderId]
    )
    const order = rows?.[0]
    const isReserved = Number(order?.inventory_reserved) === 1
      || String(order?.inventory_state || '') === 'reserved'
    if (!order || !isReserved) {
      if (ownsConnection) await runner.rollback()
      return { released: false, affected: { rightIds: [], artworkIds: [], digitalIds: [] } }
    }

    // 先回补库存，再清标记，避免中途崩溃导致「标记已清、库存未回」
    const items = await loadOrderItemsByOrderId(orderId, runner)
    const affected = await releaseOrderItemsInventory({ orderItems: items, connection: runner })

    const [claimResult] = await queryWithConnection(
      runner,
      `UPDATE orders
       SET inventory_reserved = 0,
           inventory_state = 'none'
       WHERE id = ?
         AND (inventory_reserved = 1 OR inventory_state = 'reserved')`,
      [orderId]
    )
    if (!claimResult?.affectedRows) {
      if (ownsConnection) await runner.rollback()
      return { released: false, affected: { rightIds: [], artworkIds: [], digitalIds: [] } }
    }

    if (ownsConnection) await runner.commit()
    logger.info('order inventory reservation released', { orderId })
    return { released: true, affected }
  } catch (err) {
    if (ownsConnection) await runner.rollback()
    throw err
  } finally {
    if (ownsConnection) runner.release()
  }
}

function mapPricedItemsToReserveRows(orderId, pricedCartItems) {
  return (pricedCartItems || []).map((item) => ({
    order_id: orderId,
    type: item.type,
    quantity: item.quantity,
    right_id: item.right_id || null,
    artwork_id: item.artwork_id || null,
    digital_artwork_id: item.digital_artwork_id || null,
  }))
}

async function reserveInventoryForPendingOrder({ orderId, pricedCartItems, connection }) {
  await ensureOrderInventoryReservedColumn()

  const orderItems = mapPricedItemsToReserveRows(orderId, pricedCartItems)
  const affected = await reserveOrderItemsInventory({ orderItems, connection })
  await queryWithConnection(
    connection,
    `UPDATE orders
     SET inventory_reserved = 1,
         inventory_state = 'reserved'
     WHERE id = ?`,
    [orderId]
  )

  logger.info('order inventory reserved', { orderId })
  return affected
}

module.exports = {
  InventoryReserveError,
  buildReserveBoostFromItems,
  cartItemReserveKey,
  cartItemsOverlap,
  loadOrderItemsByOrderId,
  loadOrderInventoryReserveBoost,
  loadUserPendingReserveBoostForCart,
  loadCheckoutReserveBoost,
  releaseOrderItemsInventory,
  reserveOrderItemsInventory,
  releaseOrderInventoryIfReserved,
  releaseOverlappingUserPendingInventory,
  reserveInventoryForPendingOrder,
}
