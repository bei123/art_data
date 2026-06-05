const db = require('../db')
const logger = require('./logger')

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external'

/** Wespace 同步落库的 price 单位为分；本地 digital_artworks 与支付接口使用元 */
const WESPACE_PRICE_FEN_PER_YUAN = 100

let idColumnsEnsured = false

function normalizeWespacePriceToYuan(raw) {
  const n = typeof raw === 'number' ? raw : parseFloat(raw)
  if (!Number.isFinite(n)) return 0
  return Math.round((n / WESPACE_PRICE_FEN_PER_YUAN) * 100) / 100
}

function parseDigitalArtworkId(raw) {
  if (raw === undefined || raw === null) return { error: '缺少有效的数字艺术品ID' }

  let sid = ''
  if (typeof raw === 'string') {
    sid = raw.trim()
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > Number.MAX_SAFE_INTEGER || raw < Number.MIN_SAFE_INTEGER) {
      return { error: '数字艺术品ID请使用字符串传递，避免大整数精度丢失' }
    }
    sid = String(Math.trunc(raw))
  } else {
    return { error: '缺少有效的数字艺术品ID' }
  }

  if (!/^\d+$/.test(sid) || sid.length < 1 || sid.length > 64) {
    return { error: '缺少有效的数字艺术品ID' }
  }

  return { id: sid }
}

function mapLegacyRow(row) {
  return {
    source: 'legacy',
    id: String(row.id),
    title: row.title || null,
    price: parseFloat(row.price),
    batch_quantity: row.batch_quantity,
    is_hidden: false,
    lv3_goods_number: null,
    lv3_total_num: null,
  }
}

function mapExternalRow(row) {
  return {
    source: 'external',
    id: String(row.id),
    title: row.title || null,
    price: normalizeWespacePriceToYuan(row.price),
    batch_quantity: null,
    is_hidden: row.is_hidden === 1 || row.is_hidden === true,
    lv3_goods_number: row.lv3_goods_number,
    lv3_total_num: row.lv3_total_num,
    lv3_row_is_sell: row.lv3_row_is_sell,
  }
}

function resolveDigitalStock(record) {
  if (!record) return 0
  if (record.source === 'legacy') {
    const stock = Number(record.batch_quantity)
    return Number.isFinite(stock) ? stock : 0
  }
  const stock = record.lv3_goods_number ?? record.lv3_total_num
  if (stock == null || stock === '') return null
  const n = Number(stock)
  return Number.isFinite(n) ? n : null
}

function isDigitalArtworkPurchasable(record) {
  if (!record) return false
  if (record.source === 'external' && record.is_hidden) return false
  const stock = resolveDigitalStock(record)
  if (stock === null) return true
  return stock > 0
}

function hasEnoughDigitalStock(record, quantity) {
  const stock = resolveDigitalStock(record)
  if (stock === null) return true
  return stock >= quantity
}

async function queryWithConnection(connection, sql, params) {
  if (connection && typeof connection.query === 'function') {
    return connection.query(sql, params)
  }
  return db.query(sql, params)
}

async function fetchDigitalArtworkById(id, connection = null) {
  const parsed = parseDigitalArtworkId(id)
  if (parsed.error) return null
  const sid = parsed.id

  const [legacyRows] = await queryWithConnection(
    connection,
    'SELECT id, title, price, batch_quantity FROM digital_artworks WHERE id = ? LIMIT 1',
    [sid]
  )
  if (legacyRows && legacyRows.length > 0) {
    return mapLegacyRow(legacyRows[0])
  }

  const [externalRows] = await queryWithConnection(
    connection,
    `SELECT id, title, price, is_hidden, lv3_goods_number, lv3_total_num, lv3_row_is_sell
     FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
     WHERE id = ?
     LIMIT 1`,
    [sid]
  )
  if (externalRows && externalRows.length > 0) {
    return mapExternalRow(externalRows[0])
  }

  return null
}

async function fetchDigitalArtworksByIds(ids, connection = null) {
  const map = new Map()
  const uniqueIds = [...new Set(
    (ids || [])
      .map((raw) => parseDigitalArtworkId(raw))
      .filter((parsed) => !parsed.error)
      .map((parsed) => parsed.id)
  )]

  if (uniqueIds.length === 0) return map

  const [legacyRows] = await queryWithConnection(
    connection,
    'SELECT id, title, price, batch_quantity FROM digital_artworks WHERE id IN (?)',
    [uniqueIds]
  )
  for (const row of legacyRows || []) {
    const mapped = mapLegacyRow(row)
    map.set(mapped.id, mapped)
  }

  const remainingIds = uniqueIds.filter((id) => !map.has(id))
  if (remainingIds.length === 0) return map

  const [externalRows] = await queryWithConnection(
    connection,
    `SELECT id, title, price, is_hidden, lv3_goods_number, lv3_total_num, lv3_row_is_sell
     FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
     WHERE id IN (?)`,
    [remainingIds]
  )
  for (const row of externalRows || []) {
    const mapped = mapExternalRow(row)
    map.set(mapped.id, mapped)
  }

  return map
}

async function adjustDigitalArtworkStock({ connection, id, delta }) {
  const parsed = parseDigitalArtworkId(id)
  if (parsed.error) return false
  const sid = parsed.id
  const qty = Math.abs(Number(delta))
  if (!Number.isFinite(qty) || qty <= 0) return false

  if (delta < 0) {
    const [legacyResult] = await queryWithConnection(
      connection,
      'UPDATE digital_artworks SET batch_quantity = batch_quantity - ? WHERE id = ? AND batch_quantity >= ?',
      [qty, sid, qty]
    )
    if (legacyResult?.affectedRows > 0) return true

    const [externalResult] = await queryWithConnection(
      connection,
      `UPDATE ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
       SET lv3_goods_number = lv3_goods_number - ?
       WHERE id = ? AND lv3_goods_number IS NOT NULL AND lv3_goods_number >= ?`,
      [qty, sid, qty]
    )
    if (externalResult?.affectedRows > 0) return true

    const record = await fetchDigitalArtworkById(sid, connection)
    return Boolean(record && record.source === 'external' && resolveDigitalStock(record) === null)
  }

  const [legacyRestore] = await queryWithConnection(
    connection,
    'UPDATE digital_artworks SET batch_quantity = batch_quantity + ? WHERE id = ?',
    [qty, sid]
  )
  if (legacyRestore?.affectedRows > 0) return true

  const [externalRestore] = await queryWithConnection(
    connection,
    `UPDATE ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
     SET lv3_goods_number = COALESCE(lv3_goods_number, 0) + ?
     WHERE id = ?`,
    [qty, sid]
  )
  return externalRestore?.affectedRows > 0
}

async function ensureDigitalArtworkIdColumns() {
  if (idColumnsEnsured) return

  const tables = ['order_items', 'cart_items', 'digital_identity_purchases']
  for (const table of tables) {
    try {
      await db.query(
        `ALTER TABLE ${table} MODIFY COLUMN digital_artwork_id VARCHAR(64) NULL`
      )
      logger.info('digital_artwork_id column widened', { table })
    } catch (err) {
      if (err.code !== 'ER_BAD_FIELD_ERROR') {
        logger.warn('digital_artwork_id column ensure failed', { table, err: err.message })
      }
    }
  }

  idColumnsEnsured = true
}

const DIGITAL_ITEM_JOIN_SQL = `
  LEFT JOIN digital_artworks da ON oi.type = 'digital' AND CAST(oi.digital_artwork_id AS CHAR) = CAST(da.id AS CHAR)
  LEFT JOIN digital_artworks_external dae ON oi.type = 'digital' AND CAST(oi.digital_artwork_id AS CHAR) = dae.id
`

const DIGITAL_ITEM_SELECT_SQL = `
  COALESCE(da.title, dae.title) AS digital_title,
  COALESCE(da.price, dae.price / ${WESPACE_PRICE_FEN_PER_YUAN}) AS digital_price,
  COALESCE(da.description, dae.description) AS digital_description,
  COALESCE(da.image_url, dae.image_url) AS digital_image_url,
  COALESCE(da.batch_quantity, dae.lv3_goods_number, dae.lv3_total_num) AS digital_batch_quantity
`

module.exports = {
  DIGITAL_ARTWORKS_EXTERNAL_TABLE,
  DIGITAL_ITEM_JOIN_SQL,
  DIGITAL_ITEM_SELECT_SQL,
  parseDigitalArtworkId,
  resolveDigitalStock,
  isDigitalArtworkPurchasable,
  hasEnoughDigitalStock,
  fetchDigitalArtworkById,
  fetchDigitalArtworksByIds,
  adjustDigitalArtworkStock,
  ensureDigitalArtworkIdColumns,
  normalizeWespacePriceToYuan,
  WESPACE_PRICE_FEN_PER_YUAN,
}
