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
  {
    name: 'latest_path_action_type',
    ddl: "INT NULL COMMENT '微信物流最新轨迹 action_type'",
  },
  {
    name: 'latest_path_action_at',
    ddl: "DATETIME NULL COMMENT '微信物流最新轨迹时间'",
  },
  {
    name: 'waybill_token',
    ddl: "VARCHAR(512) NULL COMMENT '微信物流消息 follow_waybill 返回的 waybill_token'",
  },
  {
    name: 'follow_status',
    ddl: "VARCHAR(32) NULL COMMENT 'pending|followed|failed'",
  },
  {
    name: 'follow_error',
    ddl: "VARCHAR(512) NULL COMMENT 'follow_waybill 失败信息'",
  },
  {
    name: 'ship_source',
    ddl: "VARCHAR(32) NULL COMMENT 'sf|manual'",
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
          waybill_token VARCHAR(512) NULL COMMENT '微信物流消息 waybill_token',
          follow_status VARCHAR(32) NULL COMMENT 'pending|followed|failed',
          follow_error VARCHAR(512) NULL,
          ship_source VARCHAR(32) NULL COMMENT 'sf|manual',
          status VARCHAR(32) NOT NULL DEFAULT 'active' COMMENT 'active|cancelled',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          KEY idx_order_shipments_order_id (order_id),
          KEY idx_order_shipments_waybill (delivery_id, waybill_id),
          KEY idx_order_shipments_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单运单记录'
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

async function persistShipmentLatestPath({ orderId, waybillId, actionType, actionAt }) {
  if (!orderId || !waybillId || actionType == null) return
  await ensureOrderShipmentsTable()
  const actionTime = actionAt ? new Date(actionAt) : new Date()
  if (Number.isNaN(actionTime.getTime())) return

  try {
    await db.query(
      `UPDATE order_shipments
       SET latest_path_action_type = ?,
           latest_path_action_at = ?
       WHERE order_id = ? AND waybill_id = ? AND status = 'active'`,
      [Number(actionType), actionTime, orderId, String(waybillId).trim()],
    )
  } catch (err) {
    logger.warn('persistShipmentLatestPath failed', { orderId, waybillId, err: err.message })
  }
}

module.exports = {
  ensureOrderShipmentsTable,
  persistShipmentLatestPath,
}
