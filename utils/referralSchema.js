const db = require('../db')
const logger = require('./logger')

let schemaReady = false

const WX_USER_TIER_COLUMNS = [
  {
    name: 'user_tier',
    ddl: "VARCHAR(32) NOT NULL DEFAULT 'normal' COMMENT '用户等级: normal/recommender/vip_collector/art_advisor'",
  },
  {
    name: 'total_spent',
    ddl: "DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT '累计消费金额(元)'",
  },
  {
    name: 'tier_upgraded_at',
    ddl: 'DATETIME NULL COMMENT ' + "'等级最近变更时间'",
  },
]

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

async function ensureWxUserTierColumns() {
  for (const col of WX_USER_TIER_COLUMNS) {
    try {
      if (await hasColumn('wx_users', col.name)) continue
      await db.query(`ALTER TABLE wx_users ADD COLUMN ${col.name} ${col.ddl}`)
      logger.info('wx_users column added', { column: col.name })
    } catch (err) {
      logger.warn('ensureWxUserTierColumns failed', { column: col.name, err: err.message })
    }
  }
}

async function ensureReferralCodesTable() {
  if (await hasTable('referral_codes')) return

  await db.query(`
    CREATE TABLE referral_codes (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      code VARCHAR(16) NOT NULL,
      status ENUM('active','disabled') NOT NULL DEFAULT 'active',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_user_id (user_id),
      UNIQUE KEY uk_code (code),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('referral_codes table created')
}

async function ensureReferralBindingsTable() {
  if (!(await hasTable('referral_bindings'))) {
    await db.query(`
      CREATE TABLE referral_bindings (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        referrer_id INT NOT NULL,
        referee_id INT NOT NULL,
        source ENUM('link','code','poster') NOT NULL,
        bound_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NULL COMMENT 'NULL=永久有效',
        PRIMARY KEY (id),
        UNIQUE KEY uk_referee_id (referee_id),
        KEY idx_referrer_id (referrer_id),
        KEY idx_expires_at (expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    logger.info('referral_bindings table created')
    return
  }

  await ensureReferralBindingsPermanent()
}

/**
 * 推荐绑定改为永久：expires_at 可空，并将历史记录清为 NULL
 */
async function ensureReferralBindingsPermanent() {
  try {
    const [cols] = await db.query(
      `SELECT IS_NULLABLE
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'referral_bindings'
         AND COLUMN_NAME = 'expires_at'
       LIMIT 1`
    )
    if (cols.length && String(cols[0].IS_NULLABLE).toUpperCase() === 'NO') {
      await db.query(
        `ALTER TABLE referral_bindings
         MODIFY COLUMN expires_at DATETIME NULL COMMENT 'NULL=永久有效'`
      )
      logger.info('referral_bindings.expires_at made nullable')
    }

    const [result] = await db.query(
      `UPDATE referral_bindings SET expires_at = NULL WHERE expires_at IS NOT NULL`
    )
    if (result?.affectedRows > 0) {
      logger.info('referral_bindings converted to permanent', {
        updated: result.affectedRows,
      })
    }
  } catch (err) {
    logger.warn('ensureReferralBindingsPermanent failed', { message: err.message })
  }
}

async function ensureShareEventsTable() {
  if (await hasTable('share_events')) return

  await db.query(`
    CREATE TABLE share_events (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      item_type ENUM('right','artwork','digital') NOT NULL,
      item_id VARCHAR(64) NOT NULL,
      channel ENUM('link','poster','miniprogram') NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_id (user_id),
      KEY idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('share_events table created')
}

/**
 * 成交临时归因（分享进店）：与永久绑定分离
 * user_id 唯一，新归因覆盖旧归因
 */
async function ensureReferralAttributionsTable() {
  if (await hasTable('referral_attributions')) return

  await db.query(`
    CREATE TABLE referral_attributions (
      user_id INT NOT NULL COMMENT '被推荐人 wx_users.id',
      referrer_id INT NOT NULL COMMENT '分享人 wx_users.id',
      source ENUM('link','code','poster') NOT NULL DEFAULT 'link',
      attributed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      PRIMARY KEY (user_id),
      KEY idx_referrer_id (referrer_id),
      KEY idx_expires_at (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('referral_attributions table created')
}

const { ensureCommissionSchema } = require('./commissionSchema')
const { ensureReferralRewardsSchema } = require('./referralRewardsSchema')

async function ensureOrdersReferrerColumn() {
  try {
    if (await hasColumn('orders', 'referrer_id')) return
    await db.query(
      "ALTER TABLE orders ADD COLUMN referrer_id INT NULL COMMENT '下单时快照的推荐人 wx_users.id'"
    )
    await db.query('ALTER TABLE orders ADD KEY idx_referrer_id (referrer_id)')
    logger.info('orders.referrer_id column added')
  } catch (err) {
    logger.warn('ensureOrdersReferrerColumn failed', { err: err.message })
  }
}

async function ensureReferralSchema() {
  if (schemaReady) return

  await ensureWxUserTierColumns()
  await ensureReferralCodesTable()
  await ensureReferralBindingsTable()
  await ensureReferralAttributionsTable()
  await ensureShareEventsTable()
  await ensureOrdersReferrerColumn()
  await ensureCommissionSchema()
  await ensureReferralRewardsSchema()

  schemaReady = true
}

module.exports = {
  ensureReferralSchema,
  ensureOrdersReferrerColumn,
}
