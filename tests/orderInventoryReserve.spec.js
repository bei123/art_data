import { describe, it, expect } from 'vitest'
import { buildReserveBoostFromItems } from '../utils/orderInventoryReserve.js'

describe('buildReserveBoostFromItems', () => {
  it('aggregates quantities by sku', () => {
    const boost = buildReserveBoostFromItems([
      { type: 'right', right_id: 1, quantity: 2 },
      { type: 'right', right_id: 1, quantity: 1 },
      { type: 'artwork', artwork_id: 9, quantity: 1 },
      { type: 'digital', digital_artwork_id: '42', quantity: 3 },
    ])
    expect(boost.rights[1]).toBe(3)
    expect(boost.artworks[9]).toBe(1)
    expect(boost.digitals['42']).toBe(3)
  })

  it('returns empty maps for invalid rows', () => {
    const boost = buildReserveBoostFromItems([
      { type: 'right', quantity: 1 },
      { type: 'artwork', artwork_id: 2, quantity: 0 },
    ])
    expect(boost.rights).toEqual({})
    expect(boost.artworks).toEqual({})
  })
})
