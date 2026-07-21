const db = require('../db')
const logger = require('./logger')

let ensured = false
let ensurePromise = null

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

async function ensureAdminRefreshTokensSchema() {
  if (ensured) return
  if (ensurePromise) return ensurePromise

  ensurePromise = (async () => {
    if (await hasTable('user_refresh_tokens')) {
      ensured = true
      return
    }

    await db.query(`
      CREATE TABLE user_refresh_tokens (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        revoked_at DATETIME NULL DEFAULT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_user_refresh_token_hash (token_hash),
        KEY idx_user_refresh_user (user_id),
        KEY idx_user_refresh_active (user_id, revoked_at, expires_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    logger.info('user_refresh_tokens table created')
    ensured = true
  })()

  try {
    await ensurePromise
  } finally {
    ensurePromise = null
  }
}

module.exports = {
  ensureAdminRefreshTokensSchema,
}
