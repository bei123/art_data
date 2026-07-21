const db = require('../db')
const logger = require('./logger')

let ensured = false

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

async function ensureDigitalQrPoolSchema() {
  if (ensured) return

  try {
    if (!(await hasTable('digital_artwork_qr_codes'))) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS digital_artwork_qr_codes (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          digital_artwork_id VARCHAR(64) NOT NULL COMMENT '与 order_items.digital_artwork_id 同语义',
          qr_code_url VARCHAR(512) NOT NULL COMMENT '领取二维码图片 URL',
          status VARCHAR(16) NOT NULL DEFAULT 'available' COMMENT 'available|assigned|void',
          order_item_id BIGINT UNSIGNED NULL COMMENT '分配后的 order_items.id',
          delivery_unit_id BIGINT UNSIGNED NULL COMMENT '关联 order_item_delivery_units.id',
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          assigned_at DATETIME NULL,
          UNIQUE KEY uk_digital_qr_url (digital_artwork_id, qr_code_url),
          KEY idx_digital_qr_available (digital_artwork_id, status, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数字艺术品领取码库存池'
      `)
      logger.info('digital_artwork_qr_codes table created')
    }

    if (!(await hasTable('order_item_delivery_units'))) {
      await db.query(`
        CREATE TABLE IF NOT EXISTS order_item_delivery_units (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
          order_id BIGINT UNSIGNED NOT NULL COMMENT 'orders.id',
          order_item_id BIGINT UNSIGNED NOT NULL COMMENT 'order_items.id',
          unit_index INT UNSIGNED NOT NULL COMMENT '1..quantity',
          qr_code_url VARCHAR(512) NULL COMMENT '最终交付 URL',
          source VARCHAR(16) NULL COMMENT 'pool|manual',
          pool_code_id BIGINT UNSIGNED NULL COMMENT 'digital_artwork_qr_codes.id',
          delivered_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uk_order_item_unit (order_item_id, unit_index),
          KEY idx_delivery_units_order (order_id),
          KEY idx_delivery_units_empty (order_item_id, qr_code_url)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数字订单行一码一单位交付槽'
      `)
      logger.info('order_item_delivery_units table created')
    }
  } catch (err) {
    logger.warn('digital QR pool schema ensure failed', { err: err.message })
    throw err
  }

  ensured = true
}

module.exports = {
  ensureDigitalQrPoolSchema,
}
