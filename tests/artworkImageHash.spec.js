import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  hammingDistance,
  computeDifferenceHashFromBuffer,
  confidenceFromDistance,
} from '../utils/artworkImageHash.js'

describe('artworkImageHash', () => {
  it('hammingDistance counts bit differences', () => {
    expect(hammingDistance('1010', '1010')).toBe(0)
    expect(hammingDistance('1010', '0101')).toBe(4)
  })

  it('computeDifferenceHashFromBuffer returns stable hash for same image', async () => {
    const buffer = await sharp({
      create: {
        width: 120,
        height: 160,
        channels: 3,
        background: { r: 120, g: 80, b: 40 },
      },
    })
      .png()
      .toBuffer()

    const a = await computeDifferenceHashFromBuffer(buffer)
    const b = await computeDifferenceHashFromBuffer(buffer)
    expect(a).toHaveLength(64)
    expect(a).toBe(b)
  })

  it('confidenceFromDistance decreases with distance', () => {
    expect(confidenceFromDistance(0)).toBe(1)
    expect(confidenceFromDistance(16)).toBeCloseTo(0.75)
    expect(confidenceFromDistance(64)).toBe(0)
  })
})
