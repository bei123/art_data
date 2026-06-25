const db = require('../db')
const logger = require('./logger')

let schemaEnsured = false

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

async function hasTrigger(triggerName) {
  const [rows] = await db.query(
    `SELECT 1
     FROM INFORMATION_SCHEMA.TRIGGERS
     WHERE TRIGGER_SCHEMA = DATABASE()
       AND TRIGGER_NAME = ?
     LIMIT 1`,
    [triggerName]
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

  await db.query(
    `UPDATE ${tableName} SET is_public_eff = IFNULL(is_public, 1)`
  )
}

async function ensurePublicEffTriggers(tableName) {
  if (!(await hasColumn(tableName, 'is_public')) || !(await hasColumn(tableName, 'is_public_eff'))) return
  if (await isGeneratedColumn(tableName, 'is_public_eff')) return

  const insertTrigger = `tr_${tableName}_is_public_eff_bi`
  const updateTrigger = `tr_${tableName}_is_public_eff_bu`

  if (!(await hasTrigger(insertTrigger))) {
    await db.query(
      `CREATE TRIGGER ${insertTrigger} BEFORE INSERT ON ${tableName}
       FOR EACH ROW SET NEW.is_public_eff = IFNULL(NEW.is_public, 1)`
    )
  }

  if (!(await hasTrigger(updateTrigger))) {
    await db.query(
      `CREATE TRIGGER ${updateTrigger} BEFORE UPDATE ON ${tableName}
       FOR EACH ROW SET NEW.is_public_eff = IFNULL(NEW.is_public, 1)`
    )
  }
}

async function ensurePublicEffColumn(tableName) {
  if (!(await hasTable(tableName))) return
  if (!(await hasColumn(tableName, 'is_public'))) {
    logger.warn('ensurePublicEffColumn skipped missing is_public', { table: tableName })
    return
  }

  if (!(await hasColumn(tableName, 'is_public_eff'))) {
    try {
      await db.query(
        `ALTER TABLE ${tableName}
         ADD COLUMN is_public_eff TINYINT NOT NULL
         GENERATED ALWAYS AS (IFNULL(is_public, 1)) STORED`
      )
      logger.info('is_public_eff generated column added', { table: tableName })
    } catch (generatedErr) {
      logger.warn('generated is_public_eff unsupported; using plain column', {
        table: tableName,
        err: generatedErr.message,
      })
      await db.query(
        `ALTER TABLE ${tableName} ADD COLUMN is_public_eff TINYINT NOT NULL DEFAULT 1`
      )
      await syncPublicEffValues(tableName)
      await ensurePublicEffTriggers(tableName)
      logger.info('is_public_eff plain column added', { table: tableName })
      return
    }
  }

  await syncPublicEffValues(tableName)
  await ensurePublicEffTriggers(tableName)
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

  try {
    await ensurePublicEffColumn('artists')
    await ensurePublicEffColumn('original_artworks')
    await ensurePublicVisibilityIndexes()
  } catch (err) {
    logger.warn('ensurePublicVisibilitySchema failed', { err: err.message })
  }
}

const ARTIST_PUBLIC_WHERE = 'a.is_public_eff = 1'
const ARTIST_PUBLIC_WHERE_UNALIASED = 'is_public_eff = 1'
const ORIGINAL_ARTWORK_PUBLIC_WHERE = 'oa.is_public_eff = 1 AND a.is_public_eff = 1'
const INDEPENDENT_PUBLIC_ARTIST_WHERE = 'a.is_public_eff = 1 AND a.institution_id IS NULL'
const INSTITUTION_PUBLIC_ARTIST_COUNT_WHERE = 'a.institution_id = i.id AND a.is_public_eff = 1'

module.exports = {
  ensurePublicVisibilitySchema,
  ARTIST_PUBLIC_WHERE,
  ARTIST_PUBLIC_WHERE_UNALIASED,
  ORIGINAL_ARTWORK_PUBLIC_WHERE,
  INDEPENDENT_PUBLIC_ARTIST_WHERE,
  INSTITUTION_PUBLIC_ARTIST_COUNT_WHERE,
}
