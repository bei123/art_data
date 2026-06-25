const db = require('../db')
const logger = require('./logger')

let indexesEnsured = false

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

async function ensureIndex(tableName, indexName, ddl) {
  if (!(await hasTable(tableName))) return
  if (await hasIndex(tableName, indexName)) return
  await db.query(ddl)
  logger.info('core table index ensured', { table: tableName, index: indexName })
}

async function ensureCoreTableIndexes() {
  if (indexesEnsured) return
  indexesEnsured = true

  try {
    await ensureIndex(
      'orders',
      'idx_orders_user_trade_created',
      'CREATE INDEX idx_orders_user_trade_created ON orders (user_id, trade_state, created_at)'
    )
    await ensureIndex(
      'order_items',
      'idx_order_items_order_id',
      'CREATE INDEX idx_order_items_order_id ON order_items (order_id)'
    )
    await ensureIndex(
      'order_items',
      'idx_order_items_order_type',
      'CREATE INDEX idx_order_items_order_type ON order_items (order_id, type)'
    )
    await ensureIndex(
      'rights',
      'idx_rights_category_id',
      'CREATE INDEX idx_rights_category_id ON rights (category_id)'
    )
    await ensureIndex(
      'digital_identity_purchases',
      'idx_dip_user_purchase_date',
      'CREATE INDEX idx_dip_user_purchase_date ON digital_identity_purchases (user_id, purchase_date)'
    )
  } catch (err) {
    logger.warn('ensureCoreTableIndexes failed', { err: err.message })
  }
}

module.exports = {
  ensureCoreTableIndexes,
}
