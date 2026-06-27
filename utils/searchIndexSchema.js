const db = require('../db')
const logger = require('./logger')

let schemaEnsured = false
const fulltextReady = {
  artists: false,
  original_artworks: false,
  institutions: false,
}

const FULLTEXT_INDEX_SPECS = {
  artists: {
    indexName: 'ft_artists_search',
    columnsSql: 'name, description, era, biography',
  },
  original_artworks: {
    indexName: 'ft_original_artworks_search',
    columnsSql: 'title, description, long_description, collection_number',
  },
  institutions: {
    indexName: 'ft_institutions_search',
    columnsSql: 'name, description, address',
  },
}

function normalizeColumnsList(columnsSql) {
  return String(columnsSql || '')
    .split(',')
    .map((col) => col.trim().toLowerCase())
    .filter(Boolean)
    .join(',')
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

async function getFulltextIndexColumns(tableName, indexName) {
  const [rows] = await db.query(
    `SELECT COLUMN_NAME, SEQ_IN_INDEX
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
       AND INDEX_TYPE = 'FULLTEXT'
     ORDER BY SEQ_IN_INDEX`,
    [tableName, indexName]
  )
  if (!rows.length) return null
  return rows.map((row) => String(row.COLUMN_NAME).toLowerCase()).join(',')
}

async function dropIndexIfExists(tableName, indexName) {
  if (!(await hasIndex(tableName, indexName))) return
  await db.query(`ALTER TABLE ${tableName} DROP INDEX ${indexName}`)
  logger.info('dropped search index', { table: tableName, index: indexName })
}

async function createFulltextIndex(tableName, indexName, columnsSql) {
  try {
    await db.query(
      `ALTER TABLE ${tableName} ADD FULLTEXT INDEX ${indexName} (${columnsSql}) WITH PARSER ngram`
    )
    logger.info('fulltext index ensured (ngram)', { table: tableName, index: indexName })
    return true
  } catch (ngramErr) {
    logger.warn('ngram fulltext unsupported; trying default parser', {
      table: tableName,
      index: indexName,
      err: ngramErr.message,
    })
  }

  try {
    await db.query(
      `ALTER TABLE ${tableName} ADD FULLTEXT INDEX ${indexName} (${columnsSql})`
    )
    logger.info('fulltext index ensured (default parser)', { table: tableName, index: indexName })
    return true
  } catch (err) {
    logger.warn('fulltext index ensure failed', { table: tableName, index: indexName, err: err.message })
    return false
  }
}

async function ensureFulltextIndex(tableName, indexName, columnsSql) {
  if (!(await hasTable(tableName))) return false

  const expectedColumns = normalizeColumnsList(columnsSql)
  if (await hasIndex(tableName, indexName)) {
    const actualColumns = await getFulltextIndexColumns(tableName, indexName)
    if (actualColumns === expectedColumns) return true
    logger.warn('fulltext index column mismatch; rebuilding', {
      table: tableName,
      index: indexName,
      expected: expectedColumns,
      actual: actualColumns,
    })
    await dropIndexIfExists(tableName, indexName)
  }

  return createFulltextIndex(tableName, indexName, columnsSql)
}

async function ensureSearchFulltextIndexes() {
  if (schemaEnsured) return fulltextReady
  schemaEnsured = true

  for (const [tableKey, spec] of Object.entries(FULLTEXT_INDEX_SPECS)) {
    const tableName = tableKey
    fulltextReady[tableKey] = await ensureFulltextIndex(
      tableName,
      spec.indexName,
      spec.columnsSql
    )
  }

  return fulltextReady
}

function isFulltextSearchReady(tableKey) {
  return Boolean(fulltextReady[tableKey])
}

function invalidateFulltextSearchReady(tableKey) {
  if (tableKey && Object.prototype.hasOwnProperty.call(fulltextReady, tableKey)) {
    fulltextReady[tableKey] = false
    return
  }
  fulltextReady.artists = false
  fulltextReady.original_artworks = false
  fulltextReady.institutions = false
}

function isFulltextIndexMismatchError(err) {
  if (!err) return false
  const message = String(err.message || '')
  return (
    err.code === 'ER_CANT_FIND_FTWIDX'
    || message.includes("Can't find FULLTEXT index matching the column list")
  )
}

function markFulltextReadyForTests(overrides = {}) {
  Object.assign(fulltextReady, overrides)
}

function resetFulltextReadyForTests() {
  fulltextReady.artists = false
  fulltextReady.original_artworks = false
  fulltextReady.institutions = false
  schemaEnsured = false
}

module.exports = {
  FULLTEXT_INDEX_SPECS,
  normalizeColumnsList,
  ensureSearchFulltextIndexes,
  isFulltextSearchReady,
  invalidateFulltextSearchReady,
  isFulltextIndexMismatchError,
  markFulltextReadyForTests,
  resetFulltextReadyForTests,
}
