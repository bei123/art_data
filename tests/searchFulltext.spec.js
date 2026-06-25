import { describe, it, expect, afterEach } from 'vitest'

const { buildArtistSearchClause, buildOriginalArtworkSearchClause } = require('../services/searchService.js')
const { markFulltextReadyForTests, resetFulltextReadyForTests } = require('../utils/searchIndexSchema.js')

describe('buildArtistSearchClause fulltext', () => {
  afterEach(() => {
    resetFulltextReadyForTests()
  })

  it('uses LIKE when fulltext index is unavailable', () => {
    const { whereSql, params } = buildArtistSearchClause(false, null, '张大千')
    expect(whereSql).toContain('LIKE ?')
    expect(whereSql).not.toContain('MATCH(')
    expect(params[0]).toBe('%张大千%')
  })

  it('uses MATCH when fulltext index is ready', () => {
    markFulltextReadyForTests({ artists: true })
    const { whereSql, params } = buildArtistSearchClause(false, null, '张大千')
    expect(whereSql).toContain('MATCH(a.name, a.description, a.era, a.biography)')
    expect(params[0]).toBe('张大千')
  })
})

describe('buildOriginalArtworkSearchClause fulltext', () => {
  afterEach(() => {
    resetFulltextReadyForTests()
  })

  it('uses MATCH for artwork title fields when fulltext is ready', () => {
    markFulltextReadyForTests({ original_artworks: true })
    const { whereSql, params } = buildOriginalArtworkSearchClause(false, '山水')
    expect(whereSql).toContain('MATCH(oa.title, oa.description, oa.long_description, oa.collection_number)')
    expect(params[0]).toBe('山水')
  })
})
