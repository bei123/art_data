const db = require('../db')
const logger = require('../utils/logger')
const { ensureDigitalQrPoolSchema } = require('../utils/digitalQrPoolSchema')

function isValidQrCodeUrl(raw) {
  if (raw == null || typeof raw !== 'string') return false
  const url = raw.trim()
  if (!url || url.length > 512) return false
  return /^https?:\/\//i.test(url)
}

function normalizeArtworkId(id) {
  const s = String(id ?? '').trim()
  return s || null
}

function hasQrCode(url) {
  return Boolean(url && String(url).trim())
}

function mapUnitRow(row) {
  return {
    id: row.id,
    order_id: row.order_id,
    order_item_id: row.order_item_id,
    unit_index: Number(row.unit_index),
    qr_code_url: row.qr_code_url || null,
    source: row.source || null,
    pool_code_id: row.pool_code_id != null ? row.pool_code_id : null,
    delivered_at: row.delivered_at || null,
  }
}

function isDigitalItemFullyDelivered(item) {
  if (!item || item.type !== 'digital') return true
  const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1
  if (Array.isArray(item.delivery_units) && item.delivery_units.length > 0) {
    const filled = item.delivery_units.filter((u) => hasQrCode(u.qr_code_url)).length
    return filled >= Math.max(qty, item.delivery_units.length)
  }
  return hasQrCode(item.delivery_qr_code_url)
}

async function loadDeliveryUnitsByOrderItemIds(orderItemIds, connection = db) {
  const ids = [...new Set((orderItemIds || []).map((id) => Number(id)).filter((id) => id > 0))]
  if (!ids.length) return new Map()

  await ensureDigitalQrPoolSchema()
  const placeholders = ids.map(() => '?').join(', ')
  const [rows] = await connection.query(
    `SELECT id, order_id, order_item_id, unit_index, qr_code_url, source, pool_code_id, delivered_at
     FROM order_item_delivery_units
     WHERE order_item_id IN (${placeholders})
     ORDER BY order_item_id ASC, unit_index ASC`,
    ids
  )

  const map = new Map()
  for (const row of rows || []) {
    const key = Number(row.order_item_id)
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(mapUnitRow(row))
  }
  return map
}

async function syncOrderItemCompatQrColumns(orderItemId, connection = db) {
  const [units] = await connection.query(
    `SELECT qr_code_url, delivered_at
     FROM order_item_delivery_units
     WHERE order_item_id = ?
     ORDER BY unit_index ASC`,
    [orderItemId]
  )

  const filled = (units || []).filter((u) => hasQrCode(u.qr_code_url))
  if (!filled.length) {
    await connection.query(
      `UPDATE order_items
       SET delivery_qr_code_url = NULL, delivery_qr_code_at = NULL
       WHERE id = ?`,
      [orderItemId]
    )
    return { filledCount: 0, total: (units || []).length, allDelivered: false }
  }

  const first = filled[0]
  const allDelivered = filled.length >= (units || []).length && (units || []).length > 0
  const latestAt = filled.reduce((max, u) => {
    if (!u.delivered_at) return max
    if (!max) return u.delivered_at
    return new Date(u.delivered_at) > new Date(max) ? u.delivered_at : max
  }, null)

  await connection.query(
    `UPDATE order_items
     SET delivery_qr_code_url = ?, delivery_qr_code_at = ?
     WHERE id = ?`,
    [String(first.qr_code_url).trim(), allDelivered ? (latestAt || new Date()) : null, orderItemId]
  )

  return {
    filledCount: filled.length,
    total: (units || []).length,
    allDelivered,
    primaryUrl: String(first.qr_code_url).trim(),
  }
}

async function ensureDeliveryUnitsForItem({ orderId, orderItemId, quantity, connection }) {
  const qty = Number(quantity) > 0 ? Number(quantity) : 1
  const [existing] = await connection.query(
    `SELECT id, unit_index, qr_code_url
     FROM order_item_delivery_units
     WHERE order_item_id = ?
     ORDER BY unit_index ASC`,
    [orderItemId]
  )

  const byIndex = new Map((existing || []).map((row) => [Number(row.unit_index), row]))
  for (let i = 1; i <= qty; i += 1) {
    if (byIndex.has(i)) continue
    await connection.query(
      `INSERT INTO order_item_delivery_units (order_id, order_item_id, unit_index)
       VALUES (?, ?, ?)`,
      [orderId, orderItemId, i]
    )
  }

  const [units] = await connection.query(
    `SELECT id, order_id, order_item_id, unit_index, qr_code_url, source, pool_code_id, delivered_at
     FROM order_item_delivery_units
     WHERE order_item_id = ?
     ORDER BY unit_index ASC`,
    [orderItemId]
  )
  return (units || []).map(mapUnitRow)
}

async function claimPoolCodesForEmptyUnits({ digitalArtworkId, emptyUnits, connection }) {
  const artworkId = normalizeArtworkId(digitalArtworkId)
  if (!artworkId || !emptyUnits.length) return []

  const [available] = await connection.query(
    `SELECT id, qr_code_url
     FROM digital_artwork_qr_codes
     WHERE digital_artwork_id = ? AND status = 'available'
     ORDER BY id ASC
     LIMIT ?
     FOR UPDATE`,
    [artworkId, emptyUnits.length]
  )

  const assigned = []
  const codes = available || []
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i]
    const unit = emptyUnits[i]
    if (!code || !unit) break

    const [claimResult] = await connection.query(
      `UPDATE digital_artwork_qr_codes
       SET status = 'assigned',
           order_item_id = ?,
           delivery_unit_id = ?,
           assigned_at = NOW()
       WHERE id = ? AND status = 'available'`,
      [unit.order_item_id, unit.id, code.id]
    )
    if (!claimResult?.affectedRows) continue

    await connection.query(
      `UPDATE order_item_delivery_units
       SET qr_code_url = ?,
           source = 'pool',
           pool_code_id = ?,
           delivered_at = NOW()
       WHERE id = ? AND (qr_code_url IS NULL OR qr_code_url = '')`,
      [code.qr_code_url, code.id, unit.id]
    )

    assigned.push({
      unit_id: unit.id,
      unit_index: unit.unit_index,
      pool_code_id: code.id,
      qr_code_url: code.qr_code_url,
    })
  }

  return assigned
}

async function assignPoolToOrderItem({ orderId, orderItemId, digitalArtworkId, quantity, connection }) {
  const units = await ensureDeliveryUnitsForItem({
    orderId,
    orderItemId,
    quantity,
    connection,
  })
  const emptyUnits = units.filter((u) => !hasQrCode(u.qr_code_url))
  const assigned = await claimPoolCodesForEmptyUnits({
    digitalArtworkId,
    emptyUnits,
    connection,
  })
  const sync = await syncOrderItemCompatQrColumns(orderItemId, connection)
  return { assigned, sync, unitsCount: units.length }
}

/**
 * 支付成功后：为数字行创建交付槽并从码池领取（幂等）。
 * 不应抛出导致库存事务回滚；调用方自行 try/catch。
 */
async function fulfillDigitalDeliveryForPaidOrder({ outTradeNo, orderId, connection: externalConn = null }) {
  await ensureDigitalQrPoolSchema()

  const ownsConnection = !externalConn
  const connection = externalConn || (await db.getConnection())

  try {
    if (ownsConnection) await connection.beginTransaction()

    let resolvedOrderId = orderId
    if (!resolvedOrderId) {
      const [orders] = await connection.query(
        'SELECT id, trade_state FROM orders WHERE out_trade_no = ? LIMIT 1',
        [String(outTradeNo || '').trim()]
      )
      if (!orders.length || orders[0].trade_state !== 'SUCCESS') {
        if (ownsConnection) await connection.rollback()
        return { skipped: true, reason: 'not_success' }
      }
      resolvedOrderId = orders[0].id
    }

    const [items] = await connection.query(
      `SELECT id, type, digital_artwork_id, quantity
       FROM order_items
       WHERE order_id = ? AND type = 'digital'`,
      [resolvedOrderId]
    )

    if (!items.length) {
      if (ownsConnection) await connection.commit()
      return { skipped: true, reason: 'no_digital_items' }
    }

    const results = []
    for (const item of items) {
      const artworkId = normalizeArtworkId(item.digital_artwork_id)
      if (!artworkId) continue
      const result = await assignPoolToOrderItem({
        orderId: resolvedOrderId,
        orderItemId: item.id,
        digitalArtworkId: artworkId,
        quantity: item.quantity,
        connection,
      })
      results.push({
        order_item_id: item.id,
        digital_artwork_id: artworkId,
        ...result,
      })
    }

    if (ownsConnection) await connection.commit()

    const newlyFullyDelivered = results.filter((r) => r.sync?.allDelivered && r.assigned.length > 0)
    return {
      ok: true,
      order_id: resolvedOrderId,
      items: results,
      newlyFullyDelivered,
    }
  } catch (error) {
    if (ownsConnection) await connection.rollback()
    throw error
  } finally {
    if (ownsConnection) connection.release()
  }
}

async function backfillAwaitingDigitalDelivery(digitalArtworkId, options = {}) {
  await ensureDigitalQrPoolSchema()
  const artworkId = normalizeArtworkId(digitalArtworkId)
  if (!artworkId) return { skipped: true, reason: 'missing_artwork_id' }

  const ownsConnection = !options.connection
  const connection = options.connection || (await db.getConnection())
  const fullyDeliveredItems = []

  try {
    if (ownsConnection) await connection.beginTransaction()

    const [emptyUnits] = await connection.query(
      `SELECT du.id, du.order_id, du.order_item_id, du.unit_index, du.qr_code_url,
              oi.digital_artwork_id, oi.quantity
       FROM order_item_delivery_units du
       INNER JOIN order_items oi ON oi.id = du.order_item_id
       INNER JOIN orders o ON o.id = du.order_id
       WHERE oi.type = 'digital'
         AND oi.digital_artwork_id = ?
         AND o.trade_state = 'SUCCESS'
         AND (du.qr_code_url IS NULL OR du.qr_code_url = '')
       ORDER BY COALESCE(o.success_time, o.created_at) ASC, du.order_item_id ASC, du.unit_index ASC
       FOR UPDATE`,
      [artworkId]
    )

    if (!emptyUnits.length) {
      if (ownsConnection) await connection.commit()
      return { ok: true, assignedCount: 0, fullyDeliveredItems: [] }
    }

    const assigned = await claimPoolCodesForEmptyUnits({
      digitalArtworkId: artworkId,
      emptyUnits: emptyUnits.map(mapUnitRow),
      connection,
    })

    const touchedItemIds = [...new Set(assigned.map((a) => {
      const unit = emptyUnits.find((u) => Number(u.id) === Number(a.unit_id))
      return unit ? Number(unit.order_item_id) : null
    }).filter(Boolean))]

    for (const itemId of touchedItemIds) {
      const sync = await syncOrderItemCompatQrColumns(itemId, connection)
      if (sync.allDelivered) {
        const unit = emptyUnits.find((u) => Number(u.order_item_id) === itemId)
        const [orderRows] = await connection.query(
          'SELECT out_trade_no FROM orders WHERE id = ? LIMIT 1',
          [unit?.order_id]
        )
        fullyDeliveredItems.push({
          order_id: unit?.order_id,
          order_item_id: itemId,
          out_trade_no: orderRows[0]?.out_trade_no || null,
        })
      }
    }

    if (ownsConnection) await connection.commit()
    return {
      ok: true,
      assignedCount: assigned.length,
      fullyDeliveredItems,
    }
  } catch (error) {
    if (ownsConnection) await connection.rollback()
    throw error
  } finally {
    if (ownsConnection) connection.release()
  }
}

async function manualFillDeliveryUnits({
  orderId,
  orderItemId,
  qrCodeUrl = null,
  qrCodeUrls = null,
  unitIndex = null,
  connection: externalConn = null,
}) {
  await ensureDigitalQrPoolSchema()

  const ownsConnection = !externalConn
  const connection = externalConn || (await db.getConnection())

  try {
    if (ownsConnection) await connection.beginTransaction()

    const [items] = await connection.query(
      `SELECT id, type, digital_artwork_id, quantity, order_id
       FROM order_items
       WHERE id = ? AND order_id = ?
       LIMIT 1`,
      [orderItemId, orderId]
    )
    if (!items.length) {
      if (ownsConnection) await connection.rollback()
      return { error: '订单项不存在', status: 404 }
    }
    if (items[0].type !== 'digital') {
      if (ownsConnection) await connection.rollback()
      return { error: '仅数字艺术品订单项支持上传二维码', status: 400 }
    }

    const qty = Number(items[0].quantity) > 0 ? Number(items[0].quantity) : 1
    await ensureDeliveryUnitsForItem({
      orderId,
      orderItemId,
      quantity: qty,
      connection,
    })

    const urls = []
    if (Array.isArray(qrCodeUrls)) {
      for (const u of qrCodeUrls) {
        if (isValidQrCodeUrl(u)) urls.push(String(u).trim())
      }
    } else if (isValidQrCodeUrl(qrCodeUrl)) {
      urls.push(String(qrCodeUrl).trim())
    }

    if (!urls.length) {
      if (ownsConnection) await connection.rollback()
      return { error: '请提供有效的二维码图片 URL（http/https）', status: 400 }
    }

    const [emptyOrTarget] = await connection.query(
      `SELECT id, unit_index, qr_code_url
       FROM order_item_delivery_units
       WHERE order_item_id = ?
       ORDER BY unit_index ASC
       FOR UPDATE`,
      [orderItemId]
    )

    let targets = emptyOrTarget || []
    if (unitIndex != null) {
      const idx = Number(unitIndex)
      targets = targets.filter((u) => Number(u.unit_index) === idx)
      if (!targets.length) {
        if (ownsConnection) await connection.rollback()
        return { error: '指定的交付单位不存在', status: 400 }
      }
      if (urls.length !== 1) {
        if (ownsConnection) await connection.rollback()
        return { error: '指定 unit_index 时仅支持单个二维码 URL', status: 400 }
      }
    } else {
      const empty = targets.filter((u) => !hasQrCode(u.qr_code_url))
      if (empty.length) {
        targets = empty
      } else if (urls.length === 1 && targets.length === 1) {
        // 兼容旧行为：单槽重新上传
        targets = [targets[0]]
      } else if (urls.length === 1 && targets.length > 1) {
        // 全部已有码时，单 URL 覆盖第一个空缺策略改为覆盖 unit 1
        targets = [targets[0]]
      }
    }

    const fillCount = Math.min(urls.length, targets.length)
    for (let i = 0; i < fillCount; i += 1) {
      await connection.query(
        `UPDATE order_item_delivery_units
         SET qr_code_url = ?,
             source = 'manual',
             pool_code_id = NULL,
             delivered_at = NOW()
         WHERE id = ?`,
        [urls[i], targets[i].id]
      )
    }

    const sync = await syncOrderItemCompatQrColumns(orderItemId, connection)
    const unitsMap = await loadDeliveryUnitsByOrderItemIds([orderItemId], connection)
    const deliveryUnits = unitsMap.get(Number(orderItemId)) || []

    if (ownsConnection) await connection.commit()
    return {
      ok: true,
      sync,
      delivery_units: deliveryUnits,
      filled: fillCount,
    }
  } catch (error) {
    if (ownsConnection) await connection.rollback()
    throw error
  } finally {
    if (ownsConnection) connection.release()
  }
}

/** 退款成功：已分配池码作废，不回池 */
async function voidAssignedPoolCodesForOrder({ orderId, connection }) {
  if (!orderId) return { voided: 0 }
  await ensureDigitalQrPoolSchema()

  const [result] = await connection.query(
    `UPDATE digital_artwork_qr_codes c
     INNER JOIN order_item_delivery_units du ON du.id = c.delivery_unit_id
     SET c.status = 'void'
     WHERE du.order_id = ? AND c.status = 'assigned'`,
    [orderId]
  )

  return { voided: result?.affectedRows || 0 }
}

async function getPoolStats(digitalArtworkId) {
  await ensureDigitalQrPoolSchema()
  const artworkId = normalizeArtworkId(digitalArtworkId)
  if (!artworkId) {
    return { available: 0, assigned: 0, void: 0, total: 0 }
  }

  const [rows] = await db.query(
    `SELECT status, COUNT(*) AS cnt
     FROM digital_artwork_qr_codes
     WHERE digital_artwork_id = ?
     GROUP BY status`,
    [artworkId]
  )

  const stats = { available: 0, assigned: 0, void: 0, total: 0 }
  for (const row of rows || []) {
    const key = String(row.status || '')
    const n = Number(row.cnt) || 0
    if (key in stats) stats[key] = n
    stats.total += n
  }
  return stats
}

async function listPoolCodes(digitalArtworkId, { status = null, page = 1, pageSize = 50 } = {}) {
  await ensureDigitalQrPoolSchema()
  const artworkId = normalizeArtworkId(digitalArtworkId)
  if (!artworkId) return { data: [], stats: await getPoolStats(null), pagination: { page: 1, pageSize, total: 0 } }

  const limit = Math.min(Math.max(Number(pageSize) || 50, 1), 200)
  const pageNum = Math.max(Number(page) || 1, 1)
  const offset = (pageNum - 1) * limit

  const params = [artworkId]
  let where = 'WHERE digital_artwork_id = ?'
  if (status) {
    where += ' AND status = ?'
    params.push(String(status))
  }

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) AS total FROM digital_artwork_qr_codes ${where}`,
    params
  )

  const [rows] = await db.query(
    `SELECT id, digital_artwork_id, qr_code_url, status, order_item_id, delivery_unit_id,
            created_at, assigned_at
     FROM digital_artwork_qr_codes
     ${where}
     ORDER BY id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  )

  return {
    data: rows || [],
    stats: await getPoolStats(artworkId),
    pagination: {
      page: pageNum,
      pageSize: limit,
      total: Number(total) || 0,
    },
  }
}

async function addPoolCodes(digitalArtworkId, urls) {
  await ensureDigitalQrPoolSchema()
  const artworkId = normalizeArtworkId(digitalArtworkId)
  if (!artworkId) return { error: '无效的数字艺术品 ID', status: 400 }

  const cleanUrls = [...new Set(
    (Array.isArray(urls) ? urls : [])
      .map((u) => String(u || '').trim())
      .filter((u) => isValidQrCodeUrl(u))
  )]

  if (!cleanUrls.length) return { error: '请提供至少一个有效的二维码 URL', status: 400 }

  let inserted = 0
  let skipped = 0
  for (const url of cleanUrls) {
    try {
      const [result] = await db.query(
        `INSERT INTO digital_artwork_qr_codes (digital_artwork_id, qr_code_url, status)
         VALUES (?, ?, 'available')`,
        [artworkId, url]
      )
      if (result?.affectedRows) inserted += 1
    } catch (err) {
      if (err?.code === 'ER_DUP_ENTRY') {
        skipped += 1
        continue
      }
      throw err
    }
  }

  let backfill = null
  if (inserted > 0) {
    try {
      backfill = await backfillAwaitingDigitalDelivery(artworkId)
    } catch (err) {
      logger.warn('pool add backfill failed', { artworkId, err: err?.message || err })
      backfill = { ok: false, error: err?.message || String(err) }
    }
  }

  return {
    ok: true,
    inserted,
    skipped,
    stats: await getPoolStats(artworkId),
    backfill,
  }
}

async function voidPoolCode(codeId) {
  await ensureDigitalQrPoolSchema()
  const id = Number(codeId)
  if (!id) return { error: '无效的码 ID', status: 400 }

  const [rows] = await db.query(
    'SELECT id, status FROM digital_artwork_qr_codes WHERE id = ? LIMIT 1',
    [id]
  )
  if (!rows.length) return { error: '码不存在', status: 404 }
  if (rows[0].status !== 'available') {
    return { error: '仅未分配的码可作废', status: 400 }
  }

  await db.query(
    `UPDATE digital_artwork_qr_codes SET status = 'void' WHERE id = ? AND status = 'available'`,
    [id]
  )
  return { ok: true }
}

module.exports = {
  isValidQrCodeUrl,
  hasQrCode,
  isDigitalItemFullyDelivered,
  loadDeliveryUnitsByOrderItemIds,
  fulfillDigitalDeliveryForPaidOrder,
  backfillAwaitingDigitalDelivery,
  manualFillDeliveryUnits,
  voidAssignedPoolCodesForOrder,
  getPoolStats,
  listPoolCodes,
  addPoolCodes,
  voidPoolCode,
  ensureDeliveryUnitsForItem,
  syncOrderItemCompatQrColumns,
}
