const db = require('../db')
const logger = require('./logger')

let uniqueIndexEnsured = false

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

/** 保证 orders.out_trade_no 全局唯一（幂等） */
async function ensureOrdersOutTradeNoUnique() {
  if (uniqueIndexEnsured) return

  try {
    if (await hasIndex('orders', 'uk_orders_out_trade_no')) {
      uniqueIndexEnsured = true
      return
    }
    await db.query('ALTER TABLE orders ADD UNIQUE INDEX uk_orders_out_trade_no (out_trade_no)')
    logger.info('orders.uk_orders_out_trade_no unique index ensured')
  } catch (err) {
    logger.warn('ensureOrdersOutTradeNoUnique failed', { err: err.message })
  }

  uniqueIndexEnsured = true
}

module.exports = {
  ensureOrdersOutTradeNoUnique,
}
