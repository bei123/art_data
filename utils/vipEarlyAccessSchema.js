const db = require('../db')
const logger = require('./logger')

let schemaReady = false

const PRODUCT_TABLES = [
  { table: 'rights', idColumn: 'id' },
  { table: 'original_artworks', idColumn: 'id' },
  { table: 'digital_artworks', idColumn: 'id' },
]

async function hasColumn(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  return rows.length > 0
}

async function ensureVipEarlyAccessColumns() {
  for (const { table } of PRODUCT_TABLES) {
    const hasFlag = await hasColumn(table, 'vip_early_access')
    if (!hasFlag) {
      await db.query(
        `ALTER TABLE ${table}
         ADD COLUMN vip_early_access TINYINT(1) NOT NULL DEFAULT 0
         COMMENT 'VIP优先购：1=仅VIP/顾问可购（至截止时间前）'`
      )
      logger.info(`${table}.vip_early_access column added`)
    }

    const hasUntil = await hasColumn(table, 'vip_early_until')
    if (!hasUntil) {
      await db.query(
        `ALTER TABLE ${table}
         ADD COLUMN vip_early_until DATETIME NULL
         COMMENT 'VIP优先购截止时间，为空则长期有效'`
      )
      logger.info(`${table}.vip_early_until column added`)
    }
  }
}

async function ensureAdvisorRejectReasonColumn() {
  if (await hasColumn('art_advisor_applications', 'reject_reason')) return
  await db.query(
    `ALTER TABLE art_advisor_applications
     ADD COLUMN reject_reason VARCHAR(255) NULL AFTER reviewed_at`
  )
  logger.info('art_advisor_applications.reject_reason column added')
}

async function ensureVipEarlyAccessSchema() {
  if (schemaReady) return
  await ensureVipEarlyAccessColumns()
  await ensureAdvisorRejectReasonColumn()
  schemaReady = true
}

module.exports = {
  ensureVipEarlyAccessSchema,
  PRODUCT_TABLES,
}
