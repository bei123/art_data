import { describe, expect, it } from 'vitest'
import {
  normalizeGeocodeAddress,
  buildGeocodeCacheKey,
} from '../services/mapGeocodeService.js'

describe('mapGeocodeService cache helpers', () => {
  it('normalizes whitespace in addresses', () => {
    expect(normalizeGeocodeAddress('  北京市   朝阳区  ')).toBe('北京市 朝阳区')
  })

  it('builds stable cache keys for equivalent addresses', () => {
    const a = buildGeocodeCacheKey('北京市 朝阳区')
    const b = buildGeocodeCacheKey('  北京市   朝阳区  ')
    expect(a).toBe(b)
    expect(a.startsWith('geocode:addr:')).toBe(true)
  })
})
