const db = require('../db')
const logger = require('./logger')

let schemaEnsured = false
const fulltextReady = {
  artists: false,
  original_artworks: false,
  institutions: false,
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

async function ensureFulltextIndex(tableName, indexName, columnsSql) {
  if (!(await hasTable(tableName))) return false
  if (await hasIndex(tableName, indexName)) return true

  try {
    await db.query(
      `ALTER TABLE ${tableName} ADD FULLTEXT INDEX ${indexName} (${columnsSql}) WITH PARSER ngram`
    )
    logger.info('fulltext index ensured', { table: tableName, index: indexName })
    return true
  } catch (err) {
    logger.warn('fulltext index ensure failed', { table: tableName, index: indexName, err: err.message })
    return false
  }
}

async function ensureSearchFulltextIndexes() {
  if (schemaEnsured) return fulltextReady
  schemaEnsured = true

  fulltextReady.artists = await ensureFulltextIndex(
    'artists',
    'ft_artists_search',
    'name, description, era, biography'
  )
  fulltextReady.original_artworks = await ensureFulltextIndex(
    'original_artworks',
    'ft_original_artworks_search',
    'title, description, long_description, collection_number'
  )
  fulltextReady.institutions = await ensureFulltextIndex(
    'institutions',
    'ft_institutions_search',
    'name, description, address'
  )

  return fulltextReady
}

function isFulltextSearchReady(tableKey) {
  return Boolean(fulltextReady[tableKey])
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
  ensureSearchFulltextIndexes,
  isFulltextSearchReady,
  markFulltextReadyForTests,
  resetFulltextReadyForTests,
}
