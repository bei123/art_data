import { describe, expect, it } from 'vitest'
import {
  normalizeWespacePriceToYuan,
  resolveSubmittedDigitalPriceYuan,
} from '../utils/digitalArtworkResolver.js'

describe('normalizeWespacePriceToYuan', () => {
  it('converts fen to yuan', () => {
    expect(normalizeWespacePriceToYuan(12000)).toBe(120)
    expect(normalizeWespacePriceToYuan(99)).toBe(0.99)
  })
})

describe('resolveSubmittedDigitalPriceYuan', () => {
  it('accepts yuan or fen submissions', () => {
    expect(resolveSubmittedDigitalPriceYuan(120, 120)).toBe(120)
    expect(resolveSubmittedDigitalPriceYuan(12000, 120)).toBe(120)
    expect(resolveSubmittedDigitalPriceYuan(99, 0.99)).toBe(0.99)
  })

  it('keeps mismatched values unchanged', () => {
    expect(resolveSubmittedDigitalPriceYuan(50, 120)).toBe(50)
  })
})
