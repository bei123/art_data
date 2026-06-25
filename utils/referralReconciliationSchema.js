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

async function ensureReconciliationLogsTable() {
  if (await hasTable('referral_reconciliation_logs')) return

  await db.query(`
    CREATE TABLE referral_reconciliation_logs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      status ENUM('ok','issues') NOT NULL DEFAULT 'ok',
      issue_count INT UNSIGNED NOT NULL DEFAULT 0,
      stats_json JSON NULL,
      issues_json JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_created_at (created_at),
      KEY idx_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `)
  logger.info('referral_reconciliation_logs table created')
}

async function ensureReferralReconciliationSchema() {
  if (schemaReady) return
  await ensureReconciliationLogsTable()
  schemaReady = true
}

module.exports = {
  ensureReferralReconciliationSchema,
}
