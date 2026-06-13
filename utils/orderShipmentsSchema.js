const db = require('../db')
const logger = require('./logger')

let ensured = false

const OPTIONAL_COLUMNS = [
  {
    name: 'add_source',
    ddl: "TINYINT NOT NULL DEFAULT 0 COMMENT '0小程序 2App/H5'",
  },
  {
    name: 'wx_appid',
    ddl: "VARCHAR(64) NULL COMMENT 'add_source=2 时的小程序 appid'",
  },
  {
    name: 'company_name',
    ddl: "VARCHAR(64) NULL COMMENT '快递公司名称'",
  },
]

async function hasTable(tableName) {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
     LIMIT 1`,
    [tableName],
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
    [tableName, columnName],
  )
  return rows.length > 0
}

async function ensureOrderShipmentsTable() {
  if (ensured) return

  try {
    if (!(await hasTable('order_shipments'))) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS order_shipments (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL COMMENT 'orders.id',
          delivery_id VARCHAR(32) NOT NULL COMMENT '快递公司编码',
          waybill_id VARCHAR(128) NOT NULL COMMENT '运单号',
          wechat_order_id VARCHAR(512) NULL COMMENT '微信物流 order_id',
          biz_id VARCHAR(64) NULL,
          service_type INT NULL,
          service_name VARCHAR(128) NULL,
          use_insured TINYINT NOT NULL DEFAULT 0,
          insured_value_fen INT NOT NULL DEFAULT 0,
          add_source TINYINT NOT NULL DEFAULT 0 COMMENT '0小程序 2App',
          wx_appid VARCHAR(64) NULL,
          waybill_data_json JSON NULL,
          company_name VARCHAR(64) NULL COMMENT '快递公司名称',
          status VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active|cancelled',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_order_shipments_order_id (order_id),
          KEY idx_order_shipments_waybill (delivery_id, waybill_id),
          KEY idx_order_shipments_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='微信物流运单记录'
      `)
      logger.info('order_shipments 表已创建')
    }

    for (const col of OPTIONAL_COLUMNS) {
      if (await hasColumn('order_shipments', col.name)) continue
      await db.query(`ALTER TABLE order_shipments ADD COLUMN ${col.name} ${col.ddl}`)
      logger.info('order_shipments column added', { column: col.name })
    }
  } catch (err) {
    logger.warn('order_shipments ensure failed', { err: err.message })
  }

  ensured = true
}

module.exports = {
  ensureOrderShipmentsTable,
}
