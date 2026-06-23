const db = require('../db')
const logger = require('./logger')

const ARTWORK_SHIPPING_COLUMNS = [
  { name: 'length_cm', ddl: 'DECIMAL(10,2) NULL DEFAULT NULL COMMENT \'长度(cm)\'' },
  { name: 'width_cm', ddl: 'DECIMAL(10,2) NULL DEFAULT NULL COMMENT \'宽度(cm)\'' },
  { name: 'height_cm', ddl: 'DECIMAL(10,2) NULL DEFAULT NULL COMMENT \'高度/厚度(cm)\'' },
  { name: 'weight_kg', ddl: 'DECIMAL(10,3) NULL DEFAULT NULL COMMENT \'重量(kg)\'' },
]

let shippingColumnsEnsured = false

function parsePositiveDimension(raw) {
  if (raw == null || raw === '') return null
  const num = Number(raw)
  if (!Number.isFinite(num) || num <= 0) return null
  return num
}

function getDefaultArtworkThicknessCm() {
  const raw = process.env.SF_DEFAULT_ARTWORK_THICKNESS_CM
  const parsed = Number(raw)
  if (Number.isFinite(parsed) && parsed > 0) return parsed
  return 5
}

/**
 * 从 collection_size 文本解析尺寸，如 "30×40cm"、"30x40"、"30*40*8"
 */
function parseCollectionSizeDimensions(raw) {
  if (!raw || typeof raw !== 'string') return {}

  const normalized = raw
    .trim()
    .replace(/×/g, 'x')
    .replace(/\*/g, 'x')
    .replace(/cm/gi, '')
    .replace(/毫米|mm/gi, '')
    .trim()

  const parts = normalized
    .split(/x/i)
    .map((part) => parseFloat(String(part).trim()))
    .filter((num) => Number.isFinite(num) && num > 0)

  if (parts.length >= 2) {
    return {
      length_cm: parts[0],
      width_cm: parts[1],
      height_cm: parts[2] || null,
    }
  }

  if (parts.length === 1) {
    return { length_cm: parts[0] }
  }

  return {}
}

function resolveArtworkShippingGoods(artwork) {
  if (!artwork || typeof artwork !== 'object') {
    return {
      length_cm: null,
      width_cm: null,
      height_cm: null,
      weight_kg: null,
    }
  }

  const explicitLength = parsePositiveDimension(artwork.length_cm)
  const explicitWidth = parsePositiveDimension(artwork.width_cm)
  const explicitHeight = parsePositiveDimension(artwork.height_cm)
  const explicitWeight = parsePositiveDimension(artwork.weight_kg)

  if (explicitLength && explicitWidth) {
    return {
      length_cm: explicitLength,
      width_cm: explicitWidth,
      height_cm: explicitHeight,
      weight_kg: explicitWeight,
    }
  }

  const parsed = parseCollectionSizeDimensions(artwork.collection_size)
  return {
    length_cm: explicitLength ?? parsed.length_cm ?? null,
    width_cm: explicitWidth ?? parsed.width_cm ?? null,
    height_cm: explicitHeight ?? parsed.height_cm ?? null,
    weight_kg: explicitWeight,
  }
}

function resolveArtworkHeightCmForVolume(shippingGoods) {
  const lengthCm = parsePositiveDimension(shippingGoods?.length_cm)
  const widthCm = parsePositiveDimension(shippingGoods?.width_cm)
  let heightCm = parsePositiveDimension(shippingGoods?.height_cm)
  if (lengthCm && widthCm && !heightCm) heightCm = getDefaultArtworkThicknessCm()
  return { lengthCm, widthCm, heightCm }
}

function normalizePhysicalOrderItemForShipping(row) {
  if (!row) return row
  if (row.type === 'artwork') {
    return {
      ...row,
      ...resolveArtworkShippingGoods({
        collection_size: row.collection_size,
        length_cm: row.artwork_length_cm ?? row.length_cm,
        width_cm: row.artwork_width_cm ?? row.width_cm,
        height_cm: row.artwork_height_cm ?? row.height_cm,
        weight_kg: row.artwork_weight_kg ?? row.weight_kg,
      }),
    }
  }
  if (row.type === 'right') {
    return {
      ...row,
      length_cm: row.right_length_cm ?? row.length_cm,
      width_cm: row.right_width_cm ?? row.width_cm,
      height_cm: row.right_height_cm ?? row.height_cm,
      weight_kg: row.right_weight_kg ?? row.weight_kg,
    }
  }
  return row
}

async function hasColumn(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  return rows.length > 0
}

/** 保证 original_artworks 运费尺寸字段存在（幂等） */
async function ensureArtworksShippingColumns(connection = null) {
  if (shippingColumnsEnsured) return

  const runner = connection || db
  for (const col of ARTWORK_SHIPPING_COLUMNS) {
    try {
      if (await hasColumn('original_artworks', col.name)) continue
      await runner.query(`ALTER TABLE original_artworks ADD COLUMN ${col.name} ${col.ddl}`)
      logger.info('original_artworks column added', { column: col.name })
    } catch (err) {
      logger.warn('ensureArtworksShippingColumns failed', { column: col.name, err: err.message })
    }
  }

  shippingColumnsEnsured = true
}

module.exports = {
  parseCollectionSizeDimensions,
  resolveArtworkShippingGoods,
  resolveArtworkHeightCmForVolume,
  normalizePhysicalOrderItemForShipping,
  getDefaultArtworkThicknessCm,
  ensureArtworksShippingColumns,
}
