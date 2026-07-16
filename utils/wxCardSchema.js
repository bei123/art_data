const db = require('../db')
const logger = require('./logger')

let schemaReady = false

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

async function ensureWxUserIdentityColumns() {
  const columns = [
    {
      name: 'unionid',
      ddl: "VARCHAR(64) NULL COMMENT '开放平台 unionid' AFTER openid",
    },
    {
      name: 'oa_openid',
      ddl: "VARCHAR(64) NULL COMMENT '服务号 openid（卡券）' AFTER unionid",
    },
  ]

  for (const col of columns) {
    try {
      if (await hasColumn('wx_users', col.name)) continue
      await db.query(`ALTER TABLE wx_users ADD COLUMN ${col.name} ${col.ddl}`)
      logger.info('wx_users column added', { column: col.name })
    } catch (err) {
      logger.warn('ensureWxUserIdentityColumns failed', { column: col.name, err: err.message })
    }
  }

  try {
    if (!(await hasIndex('wx_users', 'uk_wx_users_unionid'))) {
      await db.query('ALTER TABLE wx_users ADD UNIQUE KEY uk_wx_users_unionid (unionid)')
      logger.info('wx_users.uk_wx_users_unionid added')
    }
  } catch (err) {
    logger.warn('ensure uk_wx_users_unionid failed', { err: err.message })
  }

  try {
    if (!(await hasIndex('wx_users', 'idx_wx_users_oa_openid'))) {
      await db.query('ALTER TABLE wx_users ADD KEY idx_wx_users_oa_openid (oa_openid)')
      logger.info('wx_users.idx_wx_users_oa_openid added')
    }
  } catch (err) {
    logger.warn('ensure idx_wx_users_oa_openid failed', { err: err.message })
  }
}

async function ensureWxCardEventLogTable() {
  if (await hasTable('wx_card_event_log')) return

  await db.query(`
    CREATE TABLE wx_card_event_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      event_type VARCHAR(64) NOT NULL COMMENT 'user_get_card|user_consume_card|user_del_card|card_pass_check|...',
      card_id VARCHAR(64) NULL,
      code VARCHAR(32) NULL,
      oa_openid VARCHAR(64) NULL,
      outer_str VARCHAR(128) NULL,
      coupon_id BIGINT UNSIGNED NULL COMMENT '对齐后的 user_referral_coupons.id',
      raw_body MEDIUMTEXT NOT NULL,
      process_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending|done|ignored|failed',
      process_error VARCHAR(255) NULL,
      processed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_wcel_event_code (event_type, code),
      KEY idx_wcel_status (process_status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('wx_card_event_log table created')
}

async function ensureWxCardSchema() {
  if (schemaReady) return

  await ensureWxUserIdentityColumns()
  await ensureWxCardEventLogTable()
  schemaReady = true
}

module.exports = {
  ensureWxCardSchema,
  ensureWxUserIdentityColumns,
  ensureWxCardEventLogTable,
}
