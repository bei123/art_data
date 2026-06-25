const crypto = require('crypto')
const db = require('../db')
const logger = require('./logger')

const ensuredTables = new Set()

function hashSessionToken(token) {
  if (!token || typeof token !== 'string') return null
  return crypto.createHash('sha256').update(token).digest('hex')
}

async function ensureSessionTokenHashColumn(tableName) {
  if (!tableName || ensuredTables.has(tableName)) return
  try {
    const [rows] = await db.query(
      `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
        AND COLUMN_NAME = 'token_hash'
      `,
      [tableName]
    )
    if (!rows.length) {
      await db.query(
        `ALTER TABLE ${tableName} ADD COLUMN token_hash VARCHAR(64) NULL AFTER token`
      )
      await db.query(
        `CREATE INDEX idx_${tableName}_token_hash ON ${tableName} (token_hash)`
      ).catch(() => {})
      logger.info('session token_hash column added', { table: tableName })
    }
    ensuredTables.add(tableName)
  } catch (err) {
    logger.warn('ensureSessionTokenHashColumn failed', { table: tableName, err: err.message })
    ensuredTables.add(tableName)
  }
}

async function ensureAllSessionTokenHashColumns() {
  await Promise.all([
    ensureSessionTokenHashColumn('user_sessions'),
    ensureSessionTokenHashColumn('wx_user_sessions'),
  ])
}

module.exports = {
  hashSessionToken,
  ensureSessionTokenHashColumn,
  ensureAllSessionTokenHashColumns,
}
