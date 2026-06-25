const db = require('../db')
const logger = require('./logger')

let indexEnsured = false

async function hasIndex(tableName, indexName) {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [tableName, indexName]
  )
  return rows.length > 0
}

async function hasTable(tableName) {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName]
  )
  return rows.length > 0
}

/** 首图子查询依赖 (right_id, id) 索引 */
async function ensureRightImagesLookupIndex() {
  if (indexEnsured) return
  indexEnsured = true

  try {
    if (!(await hasTable('right_images'))) return
    if (await hasIndex('right_images', 'idx_right_images_right_id')) return
    await db.query('CREATE INDEX idx_right_images_right_id ON right_images (right_id, id)')
    logger.info('right_images.idx_right_images_right_id index ensured')
  } catch (err) {
    logger.warn('ensureRightImagesLookupIndex failed', { err: err.message })
  }
}

module.exports = {
  ensureRightImagesLookupIndex,
}
