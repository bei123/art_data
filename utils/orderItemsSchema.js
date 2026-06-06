const db = require('../db')
const logger = require('./logger')

let ensured = false

const QR_CODE_COLUMNS = [
  {
    name: 'delivery_qr_code_url',
    ddl: "VARCHAR(512) NULL COMMENT '数字艺术品交付二维码 URL'",
  },
  {
    name: 'delivery_qr_code_at',
    ddl: "DATETIME NULL COMMENT '数字艺术品交付二维码上传时间'",
  },
]

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

async function ensureOrderItemsQrCodeColumns() {
  if (ensured) return

  for (const col of QR_CODE_COLUMNS) {
    try {
      if (await hasColumn('order_items', col.name)) continue
      await db.query(`ALTER TABLE order_items ADD COLUMN ${col.name} ${col.ddl}`)
      logger.info('order_items column added', { column: col.name })
    } catch (err) {
      logger.warn('order_items ensure column failed', { column: col.name, err: err.message })
    }
  }

  ensured = true
}

module.exports = {
  ensureOrderItemsQrCodeColumns,
}
