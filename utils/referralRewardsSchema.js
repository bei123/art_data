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

async function ensureWithdrawalRequestsTable() {
  if (await hasTable('withdrawal_requests')) return

  await db.query(`
    CREATE TABLE withdrawal_requests (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      status ENUM('pending','processing','await_confirm','success','failed','cancelled') NOT NULL DEFAULT 'pending',
      out_bill_no VARCHAR(64) NOT NULL,
      wx_transfer_id VARCHAR(64) NULL,
      wx_state VARCHAR(32) NULL,
      wx_package_info TEXT NULL,
      fail_reason VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_out_bill_no (out_bill_no),
      KEY idx_user_status (user_id, status),
      KEY idx_status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('withdrawal_requests table created')
}

async function ensureReferralBonusGrantsTable() {
  if (await hasTable('referral_bonus_grants')) return

  await db.query(`
    CREATE TABLE referral_bonus_grants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      bonus_type VARCHAR(32) NOT NULL,
      order_id BIGINT UNSIGNED NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      status ENUM('settlable','withdrawn','cancelled') NOT NULL DEFAULT 'settlable',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_user_bonus_type (user_id, bonus_type),
      KEY idx_user_status (user_id, status),
      KEY idx_order_id (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('referral_bonus_grants table created')
}

async function ensureReferralCouponTemplatesTable() {
  if (await hasTable('referral_coupon_templates')) return

  await db.query(`
    CREATE TABLE referral_coupon_templates (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      title VARCHAR(128) NOT NULL,
      discount_yuan DECIMAL(12,2) NOT NULL,
      min_order_yuan DECIMAL(12,2) NOT NULL DEFAULT 0,
      valid_days INT NOT NULL DEFAULT 30,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      stock_id VARCHAR(32) NULL,
      stock_creator_mchid VARCHAR(32) NULL,
      wx_status VARCHAR(32) NULL,
      is_welcome TINYINT(1) NOT NULL DEFAULT 0,
      max_coupons INT UNSIGNED NOT NULL DEFAULT 10000,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_active (is_active),
      KEY idx_welcome (is_welcome, is_active),
      KEY idx_stock_id (stock_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('referral_coupon_templates table created')
}

async function ensureReferralCouponTemplateFavorColumns() {
  try {
    const columns = [
      ['stock_id', 'VARCHAR(32) NULL'],
      ['stock_creator_mchid', 'VARCHAR(32) NULL'],
      ['wx_status', 'VARCHAR(32) NULL'],
      ['is_welcome', 'TINYINT(1) NOT NULL DEFAULT 0'],
      ['max_coupons', 'INT UNSIGNED NOT NULL DEFAULT 10000'],
    ]
    for (const [name, def] of columns) {
      const [rows] = await db.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'referral_coupon_templates'
           AND COLUMN_NAME = ?
         LIMIT 1`,
        [name]
      )
      if (!rows.length) {
        await db.query(`ALTER TABLE referral_coupon_templates ADD COLUMN ${name} ${def}`)
        logger.info(`referral_coupon_templates.${name} column added`)
      }
    }
  } catch (err) {
    logger.warn('ensureReferralCouponTemplateFavorColumns failed', { err: err.message })
  }
}

async function ensureWxFavorCouponGrantsTable() {
  if (await hasTable('wx_favor_coupon_grants')) return

  await db.query(`
    CREATE TABLE wx_favor_coupon_grants (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      template_id INT UNSIGNED NULL,
      stock_id VARCHAR(32) NOT NULL,
      coupon_id VARCHAR(64) NULL,
      out_request_no VARCHAR(64) NOT NULL,
      source VARCHAR(32) NOT NULL DEFAULT 'admin',
      status ENUM('sent','failed') NOT NULL DEFAULT 'sent',
      error_message VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_out_request_no (out_request_no),
      KEY idx_user_source (user_id, source),
      KEY idx_stock_id (stock_id),
      KEY idx_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('wx_favor_coupon_grants table created')
}

async function ensureUserReferralCouponsTable() {
  if (await hasTable('user_referral_coupons')) return

  await db.query(`
    CREATE TABLE user_referral_coupons (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      user_id INT NOT NULL,
      template_id INT UNSIGNED NULL,
      title VARCHAR(128) NOT NULL,
      discount_yuan DECIMAL(12,2) NOT NULL,
      min_order_yuan DECIMAL(12,2) NOT NULL DEFAULT 0,
      status ENUM('available','used','expired','cancelled') NOT NULL DEFAULT 'available',
      source VARCHAR(32) NOT NULL DEFAULT 'admin',
      expires_at DATETIME NOT NULL,
      used_order_id BIGINT UNSIGNED NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_status (user_id, status),
      KEY idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('user_referral_coupons table created')
}

async function ensureCommissionLedgerBonusType() {
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'commission_ledger'
         AND COLUMN_NAME = 'product_type'
       LIMIT 1`
    )
    const columnType = String(rows[0]?.COLUMN_TYPE || '')
    if (columnType.includes("'bonus'")) return

    await db.query(
      `ALTER TABLE commission_ledger
       MODIFY product_type ENUM('right','artwork','digital','bonus') NOT NULL`
    )
    logger.info('commission_ledger.product_type extended with bonus')
  } catch (err) {
    logger.warn('ensureCommissionLedgerBonusType failed', { err: err.message })
  }
}

async function ensureWithdrawalUserConfirmColumns() {
  try {
    const [statusRows] = await db.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'withdrawal_requests'
         AND COLUMN_NAME = 'status'
       LIMIT 1`
    )
    const statusType = String(statusRows[0]?.COLUMN_TYPE || '')
    if (statusType && !statusType.includes('await_confirm')) {
      await db.query(
        `ALTER TABLE withdrawal_requests
         MODIFY status ENUM('pending','processing','await_confirm','success','failed','cancelled')
         NOT NULL DEFAULT 'pending'`
      )
      logger.info('withdrawal_requests.status extended with await_confirm')
    }

    const [packageRows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'withdrawal_requests'
         AND COLUMN_NAME = 'wx_package_info'
       LIMIT 1`
    )
    if (!packageRows.length) {
      await db.query(
        'ALTER TABLE withdrawal_requests ADD COLUMN wx_package_info TEXT NULL AFTER wx_state'
      )
      logger.info('withdrawal_requests.wx_package_info column added')
    }
  } catch (err) {
    logger.warn('ensureWithdrawalUserConfirmColumns failed', { err: err.message })
  }
}

async function ensureUserReferralCouponReservedStatus() {
  try {
    const [rows] = await db.query(
      `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'user_referral_coupons'
         AND COLUMN_NAME = 'status'
       LIMIT 1`
    )
    const columnType = String(rows[0]?.COLUMN_TYPE || '')
    if (!columnType || columnType.includes("'reserved'")) return
    await db.query(
      `ALTER TABLE user_referral_coupons
       MODIFY status ENUM('available','reserved','used','expired','cancelled')
       NOT NULL DEFAULT 'available'`
    )
    logger.info('user_referral_coupons.status reserved enum added')
  } catch (err) {
    logger.warn('ensureUserReferralCouponReservedStatus failed', { err: err.message })
  }
}

async function ensureOrdersReferralCouponColumn() {
  try {
    const [rows] = await db.query(
      `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME = 'referral_coupon_id'
       LIMIT 1`
    )
    if (rows.length) return
    await db.query(
      'ALTER TABLE orders ADD COLUMN referral_coupon_id BIGINT UNSIGNED NULL COMMENT \'使用的推荐优惠券 user_referral_coupons.id\''
    )
    await db.query('ALTER TABLE orders ADD KEY idx_orders_referral_coupon_id (referral_coupon_id)')
    logger.info('orders.referral_coupon_id column added')
  } catch (err) {
    logger.warn('ensureOrdersReferralCouponColumn failed', { err: err.message })
  }
}

async function ensureReferralRewardsSchema() {
  if (schemaReady) return

  await ensureWithdrawalRequestsTable()
  await ensureWithdrawalUserConfirmColumns()
  await ensureReferralBonusGrantsTable()
  await ensureReferralCouponTemplatesTable()
  await ensureReferralCouponTemplateFavorColumns()
  await ensureWxFavorCouponGrantsTable()
  await ensureUserReferralCouponsTable()
  await ensureUserReferralCouponReservedStatus()
  await ensureCommissionLedgerBonusType()
  await ensureOrdersReferralCouponColumn()

  const { ensureVipEarlyAccessSchema } = require('./vipEarlyAccessSchema')
  await ensureVipEarlyAccessSchema()

  schemaReady = true
}

module.exports = {
  ensureReferralRewardsSchema,
}
