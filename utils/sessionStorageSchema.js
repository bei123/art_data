const db = require('../db')
const logger = require('./logger')

const SESSION_TOKEN_MIN_WIDTH = 512
const ensuredTables = new Set()

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

async function getTokenColumnWidth(tableName) {
  const [rows] = await db.query(
    `SELECT CHARACTER_MAXIMUM_LENGTH
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = 'token'
     LIMIT 1`,
    [tableName]
  )
  const width = Number(rows[0]?.CHARACTER_MAXIMUM_LENGTH)
  return Number.isFinite(width) ? width : null
}

async function ensureSessionTokenColumnWidth(tableName) {
  const width = await getTokenColumnWidth(tableName)
  if (!width || width >= SESSION_TOKEN_MIN_WIDTH) return

  await db.query(
    `ALTER TABLE ${tableName} MODIFY COLUMN token VARCHAR(${SESSION_TOKEN_MIN_WIDTH}) NOT NULL`
  )
  logger.info('session token column widened', { table: tableName, from: width, to: SESSION_TOKEN_MIN_WIDTH })
}

async function backfillSessionTokenHash(tableName) {
  if (!(await hasColumn(tableName, 'token_hash'))) return

  await db.query(
    `UPDATE ${tableName}
     SET token_hash = SHA2(token, 256)
     WHERE token_hash IS NULL AND token IS NOT NULL AND token != ''`
  )
}

async function migrateSessionUniqueToTokenHash(tableName) {
  if (!(await hasColumn(tableName, 'token_hash'))) return

  const uniqueIndexName = `uk_${tableName}_token_hash`

  if (await hasIndex(tableName, 'uk_token')) {
    await db.query(`ALTER TABLE ${tableName} DROP INDEX uk_token`)
    logger.info('dropped legacy uk_token index', { table: tableName })
  }

  if (await hasIndex(tableName, uniqueIndexName)) return

  await backfillSessionTokenHash(tableName)
  await db.query(`ALTER TABLE ${tableName} ADD UNIQUE INDEX ${uniqueIndexName} (token_hash)`)
  logger.info('session unique index on token_hash ensured', { table: tableName, index: uniqueIndexName })
}

async function ensureSessionStorageSchema(tableName) {
  if (!tableName || ensuredTables.has(tableName)) return
  ensuredTables.add(tableName)

  try {
    await ensureSessionTokenColumnWidth(tableName)
    await migrateSessionUniqueToTokenHash(tableName)
  } catch (err) {
    logger.warn('ensureSessionStorageSchema failed', { table: tableName, err: err.message })
  }
}

async function ensureAllSessionStorageSchemas() {
  await Promise.all([
    ensureSessionStorageSchema('wx_user_sessions'),
    ensureSessionStorageSchema('user_sessions'),
  ])
}

module.exports = {
  SESSION_TOKEN_MIN_WIDTH,
  ensureSessionStorageSchema,
  ensureAllSessionStorageSchemas,
}
