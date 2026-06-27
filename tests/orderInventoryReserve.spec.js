import { describe, it, expect } from 'vitest'
import {
  buildReserveBoostFromItems,
  cartItemReserveKey,
  cartItemsOverlap,
} from '../utils/orderInventoryReserve.js'

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

describe('cart item overlap helpers', () => {
  it('builds stable reserve keys', () => {
    expect(cartItemReserveKey({ type: 'right', right_id: 5 })).toBe('right:5')
    expect(cartItemReserveKey({ type: 'digital', digital_artwork_id: 7 })).toBe('digital:7')
  })

  it('detects overlapping skus between order and cart', () => {
    const orderItems = [{ type: 'artwork', artwork_id: 3, quantity: 1 }]
    const sameCart = [{ type: 'artwork', artwork_id: 3, quantity: 1 }]
    const otherCart = [{ type: 'right', right_id: 1, quantity: 1 }]
    expect(cartItemsOverlap(orderItems, sameCart)).toBe(true)
    expect(cartItemsOverlap(orderItems, otherCart)).toBe(false)
  })
})
