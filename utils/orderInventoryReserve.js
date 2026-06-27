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

  const [[order]] = await queryWithConnection(
    connection,
    'SELECT inventory_reserved FROM orders WHERE id = ? LIMIT 1',
    [orderId]
  )
  if (!order?.inventory_reserved) return empty

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

  const [[order]] = await queryWithConnection(
    connection,
    'SELECT id, inventory_reserved FROM orders WHERE id = ? LIMIT 1',
    [orderId]
  )
  if (!order?.inventory_reserved) {
    return { released: false, affected: { rightIds: [], artworkIds: [], digitalIds: [] } }
  }

  const items = await loadOrderItemsByOrderId(orderId, connection)
  const affected = await releaseOrderItemsInventory({ orderItems: items, connection })
  await queryWithConnection(
    connection,
    'UPDATE orders SET inventory_reserved = 0 WHERE id = ?',
    [orderId]
  )

  logger.info('order inventory reservation released', { orderId })
  return { released: true, affected }
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
    'UPDATE orders SET inventory_reserved = 1 WHERE id = ?',
    [orderId]
  )

  logger.info('order inventory reserved', { orderId })
  return affected
}

module.exports = {
  InventoryReserveError,
  buildReserveBoostFromItems,
  loadOrderItemsByOrderId,
  loadOrderInventoryReserveBoost,
  releaseOrderItemsInventory,
  reserveOrderItemsInventory,
  releaseOrderInventoryIfReserved,
  reserveInventoryForPendingOrder,
}
