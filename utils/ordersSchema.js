const db = require('../db')
const logger = require('./logger')

let uniqueIndexEnsured = false
let shippingColumnsEnsured = false
let inventoryReservedColumnEnsured = false
let inventoryStateColumnEnsured = false

const SHIPPING_COLUMNS = [
  {
    name: 'shipping_fee',
    ddl: "DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT '运费(元)'",
  },
  {
    name: 'express_type_id',
    ddl: 'INT NULL COMMENT \'顺丰产品类型\'',
  },
  {
    name: 'shipping_snapshot',
    ddl: "JSON NULL COMMENT '运费询价快照'",
  },
  {
    name: 'payment_total',
    ddl: "DECIMAL(10,2) NULL COMMENT '提交微信JSAPI的标价(元)，退款amount.total用；券后actual_fee为实付'",
  },
]

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

/** 保证 orders 运费相关字段存在（幂等） */
async function ensureOrdersShippingColumns() {
  if (shippingColumnsEnsured) return

  for (const col of SHIPPING_COLUMNS) {
    try {
      if (await hasColumn('orders', col.name)) continue
      await db.query(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.ddl}`)
      logger.info('orders column added', { column: col.name })
    } catch (err) {
      logger.warn('ensureOrdersShippingColumns failed', { column: col.name, err: err.message })
    }
  }

  shippingColumnsEnsured = true
}

/** 未支付订单是否已预扣库存（锁单） */
async function ensureOrderInventoryReservedColumn() {
  if (inventoryReservedColumnEnsured) return

  try {
    if (!(await hasColumn('orders', 'inventory_reserved'))) {
      await db.query(
        'ALTER TABLE orders ADD COLUMN inventory_reserved TINYINT NOT NULL DEFAULT 0 COMMENT \'未支付订单已预扣库存\''
      )
      logger.info('orders.inventory_reserved column added')
    }
  } catch (err) {
    logger.warn('ensureOrderInventoryReservedColumn failed', { err: err.message })
  }

  inventoryReservedColumnEnsured = true
  await ensureOrderInventoryStateColumn()
}

/**
 * none | reserved | fulfilled | restored
 * 支付履约与退款回滚的权威状态；inventory_reserved 保留兼容旧逻辑。
 */
async function ensureOrderInventoryStateColumn() {
  if (inventoryStateColumnEnsured) return

  try {
    if (!(await hasColumn('orders', 'inventory_state'))) {
      await db.query(
        `ALTER TABLE orders
         ADD COLUMN inventory_state VARCHAR(16) NOT NULL DEFAULT 'none'
         COMMENT '库存占用状态 none|reserved|fulfilled|restored'`
      )
      logger.info('orders.inventory_state column added')
      await db.query(
        `UPDATE orders SET inventory_state = 'reserved'
         WHERE inventory_reserved = 1 AND inventory_state = 'none'`
      )
    }
    inventoryStateColumnEnsured = true
  } catch (err) {
    logger.warn('ensureOrderInventoryStateColumn failed', { err: err.message })
    // 失败不置位，下次重试；调用方在支付/退款路径会再次 ensure
  }
}

module.exports = {
  ensureOrdersOutTradeNoUnique,
  ensureOrdersShippingColumns,
  ensureOrderInventoryReservedColumn,
  ensureOrderInventoryStateColumn,
}
