const db = require('../db')
const logger = require('./logger')

let schemaReady = false

async function hasTable(tableName) {
  const [rows] = await db.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
    [tableName]
  )
  return rows.length > 0
}

async function ensureCommissionRateRulesTable() {
  if (await hasTable('commission_rate_rules')) return

  await db.query(`
    CREATE TABLE commission_rate_rules (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      product_type ENUM('right','artwork','digital') NOT NULL,
      min_price DECIMAL(12,2) NOT NULL,
      max_price DECIMAL(12,2) NULL,
      base_rate DECIMAL(5,4) NOT NULL,
      settlement_days INT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_product_type_active (product_type, is_active),
      KEY idx_min_price (min_price)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('commission_rate_rules table created')
}

async function ensureCommissionLedgerTable() {
  if (await hasTable('commission_ledger')) return

  await db.query(`
    CREATE TABLE commission_ledger (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL COMMENT '推荐官 wx_users.id',
      order_id BIGINT UNSIGNED NOT NULL,
      order_item_id BIGINT UNSIGNED NOT NULL,
      referee_id INT NOT NULL COMMENT '买家 wx_users.id',
      product_type ENUM('right','artwork','digital') NOT NULL,
      order_amount DECIMAL(12,2) NOT NULL,
      base_rate DECIMAL(5,4) NOT NULL,
      bonus_rate DECIMAL(5,4) NOT NULL DEFAULT 0,
      final_rate DECIMAL(5,4) NOT NULL,
      commission_amount DECIMAL(12,2) NOT NULL,
      settlement_days INT NOT NULL,
      status ENUM('pending','settlable','withdrawn','cancelled') NOT NULL DEFAULT 'pending',
      settle_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_order_item (order_item_id),
      KEY idx_user_status (user_id, status),
      KEY idx_order_id (order_id),
      KEY idx_status_settle (status, settle_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('commission_ledger table created')
}

async function ensureUserWalletsTable() {
  if (await hasTable('user_wallets')) return

  await db.query(`
    CREATE TABLE user_wallets (
      user_id INT NOT NULL,
      pending_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      available_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_earned DECIMAL(12,2) NOT NULL DEFAULT 0,
      total_withdrawn DECIMAL(12,2) NOT NULL DEFAULT 0,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('user_wallets table created')
}

async function ensureArtAdvisorApplicationsTable() {
  if (await hasTable('art_advisor_applications')) return

  await db.query(`
    CREATE TABLE art_advisor_applications (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      real_name VARCHAR(64) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      company_name VARCHAR(128) NOT NULL,
      profession VARCHAR(64) NOT NULL,
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      commission_rate DECIMAL(5,4) NULL,
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_id (user_id),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('art_advisor_applications table created')
}

async function ensureCommissionSchema() {
  if (schemaReady) return

  await ensureCommissionRateRulesTable()
  await ensureCommissionLedgerTable()
  await ensureUserWalletsTable()
  await ensureArtAdvisorApplicationsTable()

  schemaReady = true
}

module.exports = {
  ensureCommissionSchema,
}
