const db = require('../db')
const logger = require('./logger')

const SESSION_TOKEN_MIN_WIDTH = 512
const ensuredTables = new Set()

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

async function recomputeSessionTokenHashes(tableName) {
  if (!(await hasColumn(tableName, 'token_hash'))) return

  await db.query(
    `UPDATE ${tableName}
     SET token_hash = SHA2(token, 256)
     WHERE token IS NOT NULL AND token != ''`
  )
}

async function dedupeSessionTokenHashes(tableName) {
  if (!(await hasColumn(tableName, 'token_hash'))) return 0

  const [expired] = await db.query(
    `DELETE FROM ${tableName} WHERE expires_at IS NOT NULL AND expires_at <= NOW()`
  )
  const expiredCount = expired?.affectedRows || 0

  await recomputeSessionTokenHashes(tableName)

  const [dupes] = await db.query(
    `DELETE s1 FROM ${tableName} s1
     INNER JOIN ${tableName} s2
       ON s1.token_hash = s2.token_hash AND s1.id < s2.id
     WHERE s1.token_hash IS NOT NULL AND s1.token_hash != ''`
  )
  const dupeCount = dupes?.affectedRows || 0

  if (expiredCount > 0 || dupeCount > 0) {
    logger.info('session rows deduped before token_hash index', {
      table: tableName,
      expiredRemoved: expiredCount,
      duplicatesRemoved: dupeCount,
    })
  }

  return dupeCount
}

async function ensureTokenHashLookupIndex(tableName) {
  const lookupIndex = `idx_${tableName}_token_hash`
  if (await hasIndex(tableName, lookupIndex)) return
  await db.query(`CREATE INDEX ${lookupIndex} ON ${tableName} (token_hash)`)
  logger.info('session non-unique token_hash index ensured', { table: tableName, index: lookupIndex })
}

async function migrateSessionUniqueToTokenHash(tableName) {
  if (!(await hasColumn(tableName, 'token_hash'))) return

  const uniqueIndexName = `uk_${tableName}_token_hash`

  if (await hasIndex(tableName, 'uk_token')) {
    await db.query(`ALTER TABLE ${tableName} DROP INDEX uk_token`)
    logger.info('dropped legacy uk_token index', { table: tableName })
  }

  if (await hasIndex(tableName, uniqueIndexName)) return

  await dedupeSessionTokenHashes(tableName)

  try {
    await db.query(`ALTER TABLE ${tableName} ADD UNIQUE INDEX ${uniqueIndexName} (token_hash)`)
    logger.info('session unique index on token_hash ensured', { table: tableName, index: uniqueIndexName })
  } catch (err) {
    if (err.code !== 'ER_DUP_ENTRY' && err.errno !== 1062) throw err

    logger.warn('token_hash duplicates remain after dedupe; using non-unique index', {
      table: tableName,
      err: err.message,
    })
    await dedupeSessionTokenHashes(tableName)
    await ensureTokenHashLookupIndex(tableName)
  }
}

async function ensureSessionStorageSchema(tableName) {
  if (!tableName || ensuredTables.has(tableName)) return
  ensuredTables.add(tableName)

  if (!(await hasTable(tableName))) {
    logger.warn('ensureSessionStorageSchema skipped missing table', { table: tableName })
    return
  }

  try {
    await ensureSessionTokenColumnWidth(tableName)
    await migrateSessionUniqueToTokenHash(tableName)
  } catch (err) {
    logger.warn('ensureSessionStorageSchema failed', { table: tableName, err: err.message })
  }
}

async function ensureAllSessionStorageSchemas() {
  await ensureSessionStorageSchema('wx_user_sessions')
  await ensureSessionStorageSchema('user_sessions')
}

module.exports = {
  SESSION_TOKEN_MIN_WIDTH,
  dedupeSessionTokenHashes,
  ensureSessionStorageSchema,
  ensureAllSessionStorageSchemas,
}
