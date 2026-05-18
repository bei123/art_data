import { describe, it, expect } from 'vitest'

const { buildOriginalArtworkSearchClause } = require('../services/searchService.js')

describe('buildOriginalArtworkSearchClause', () => {
  it('filters public artworks for anonymous search', () => {
    const { whereSql, params } = buildOriginalArtworkSearchClause(false, '张大千')
    expect(whereSql).toContain('oa.is_public')
    expect(whereSql).toContain('oa.title LIKE ?')
    expect(whereSql).not.toContain('wms_record_id')
    expect(params[0]).toBe('%张大千%')
  })

  it('includes hidden artworks and wms_record_id for admin search', () => {
    const { whereSql, params } = buildOriginalArtworkSearchClause(true, '12345')
    expect(whereSql).not.toContain('oa.is_public')
    expect(whereSql).toContain('wms_record_id')
    expect(whereSql).toContain('collection_number')
    expect(params).toContain('%12345%')
  })
})
