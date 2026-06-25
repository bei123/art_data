const db = require('../db')
const logger = require('./logger')

let schemaEnsured = false

function toIsPublicEff(raw) {
  if (raw === 0 || raw === false || raw === '0') return 0
  return 1
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

async function isGeneratedColumn(tableName, columnName) {
  const [rows] = await db.query(
    `SELECT EXTRA
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  )
  const extra = String(rows[0]?.EXTRA || '').toLowerCase()
  return extra.includes('generated')
}

async function syncPublicEffValues(tableName) {
  if (!(await hasColumn(tableName, 'is_public_eff'))) return
  if (await isGeneratedColumn(tableName, 'is_public_eff')) return
  if (!(await hasColumn(tableName, 'is_public'))) return

  await db.query(`UPDATE ${tableName} SET is_public_eff = IFNULL(is_public, 1)`)
}

async function ensurePublicEffColumn(tableName) {
  if (!(await hasTable(tableName))) return
  if (!(await hasColumn(tableName, 'is_public'))) {
    logger.warn('ensurePublicEffColumn skipped missing is_public', { table: tableName })
    return
  }

  if (!(await hasColumn(tableName, 'is_public_eff'))) {
    await db.query(
      `ALTER TABLE ${tableName} ADD COLUMN is_public_eff TINYINT NOT NULL DEFAULT 1`
    )
    logger.info('is_public_eff column added', { table: tableName })
  }

  await syncPublicEffValues(tableName)
}

async function ensurePublicVisibilityIndexes() {
  if (!(await hasColumn('original_artworks', 'is_public_eff'))) return

  if ((await hasTable('original_artworks')) && !(await hasIndex('original_artworks', 'idx_oa_public_created'))) {
    await db.query(
      'CREATE INDEX idx_oa_public_created ON original_artworks (is_public_eff, created_at)'
    )
    logger.info('idx_oa_public_created ensured')
  }

  if ((await hasTable('artists')) && !(await hasIndex('artists', 'idx_artists_public_sort'))) {
    await db.query(
      'CREATE INDEX idx_artists_public_sort ON artists (is_public_eff, sort_order, id)'
    )
    logger.info('idx_artists_public_sort ensured')
  }

  if ((await hasTable('artists')) && !(await hasIndex('artists', 'idx_artists_inst_public_sort'))) {
    await db.query(
      'CREATE INDEX idx_artists_inst_public_sort ON artists (institution_id, is_public_eff, sort_order)'
    )
    logger.info('idx_artists_inst_public_sort ensured')
  }
}

async function ensurePublicVisibilitySchema() {
  if (schemaEnsured) return
  schemaEnsured = true

  for (const table of ['artists', 'original_artworks']) {
    try {
      await ensurePublicEffColumn(table)
    } catch (err) {
      logger.warn('ensurePublicEffColumn failed', { table, err: err.message })
    }
  }

  try {
    await ensurePublicVisibilityIndexes()
  } catch (err) {
    logger.warn('ensurePublicVisibilityIndexes failed', { err: err.message })
  }
}

const ARTIST_PUBLIC_WHERE = 'a.is_public_eff = 1'
const ARTIST_PUBLIC_WHERE_UNALIASED = 'is_public_eff = 1'
const ORIGINAL_ARTWORK_PUBLIC_WHERE = 'oa.is_public_eff = 1 AND a.is_public_eff = 1'
const INDEPENDENT_PUBLIC_ARTIST_WHERE = 'a.is_public_eff = 1 AND a.institution_id IS NULL'
const INSTITUTION_PUBLIC_ARTIST_COUNT_WHERE = 'a.institution_id = i.id AND a.is_public_eff = 1'

module.exports = {
  toIsPublicEff,
  ensurePublicVisibilitySchema,
  ARTIST_PUBLIC_WHERE,
  ARTIST_PUBLIC_WHERE_UNALIASED,
  ORIGINAL_ARTWORK_PUBLIC_WHERE,
  INDEPENDENT_PUBLIC_ARTIST_WHERE,
  INSTITUTION_PUBLIC_ARTIST_COUNT_WHERE,
}
