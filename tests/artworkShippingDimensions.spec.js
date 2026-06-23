import { describe, it, expect } from 'vitest'
import {
  parseCollectionSizeDimensions,
  resolveArtworkShippingGoods,
  resolveArtworkHeightCmForVolume,
  normalizePhysicalOrderItemForShipping,
} from '../utils/artworkShippingDimensions.js'

describe('artworkShippingDimensions', () => {
  it('parseCollectionSizeDimensions parses WMS style size text', () => {
    expect(parseCollectionSizeDimensions('30×40cm')).toEqual({
      length_cm: 30,
      width_cm: 40,
      height_cm: null,
    })
    expect(parseCollectionSizeDimensions('30x40x8')).toEqual({
      length_cm: 30,
      width_cm: 40,
      height_cm: 8,
    })
  })

  it('resolveArtworkShippingGoods prefers explicit columns over collection_size', () => {
    const goods = resolveArtworkShippingGoods({
      collection_size: '10×20cm',
      length_cm: 50,
      width_cm: 60,
    })
    expect(goods).toEqual({
      length_cm: 50,
      width_cm: 60,
      height_cm: null,
      weight_kg: null,
    })
  })

  it('resolveArtworkShippingGoods falls back to collection_size', () => {
    const goods = resolveArtworkShippingGoods({ collection_size: '30×40cm' })
    expect(goods.length_cm).toBe(30)
    expect(goods.width_cm).toBe(40)
  })

  it('resolveArtworkHeightCmForVolume applies default thickness', () => {
    const resolved = resolveArtworkHeightCmForVolume({ length_cm: 30, width_cm: 40 })
    expect(resolved.lengthCm).toBe(30)
    expect(resolved.widthCm).toBe(40)
    expect(resolved.heightCm).toBe(5)
  })

  it('normalizePhysicalOrderItemForShipping maps logistics artwork row', () => {
    const row = normalizePhysicalOrderItemForShipping({
      type: 'artwork',
      artwork_id: 9,
      collection_size: '30×40cm',
      artwork_length_cm: null,
      artwork_width_cm: null,
    })
    expect(row.length_cm).toBe(30)
    expect(row.width_cm).toBe(40)
  })
})
