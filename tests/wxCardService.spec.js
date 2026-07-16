import { describe, it, expect } from 'vitest'
import {
  buildCardExtSignature,
  generateWxCouponCode,
  yuanToFen,
} from '../services/wxCardService.js'

describe('wxCardService helpers', () => {
  it('yuanToFen converts money safely', () => {
    expect(yuanToFen(20)).toBe(2000)
    expect(yuanToFen('12.34')).toBe(1234)
    expect(yuanToFen(-1)).toBe(0)
  })

  it('generateWxCouponCode is unique-ish and within length', () => {
    const a = generateWxCouponCode()
    const b = generateWxCouponCode()
    expect(a).toMatch(/^RC[0-9a-f]+$/)
    expect(a.length).toBeLessThanOrEqual(20)
    expect(a).not.toBe(b)
  })

  it('buildCardExtSignature is deterministic for same inputs', () => {
    const args = {
      apiTicket: 'ticket',
      timestamp: '1710000000',
      nonceStr: 'nonce',
      cardId: 'pCARD',
      code: 'RC123',
      openid: '',
    }
    const once = buildCardExtSignature(args)
    const twice = buildCardExtSignature(args)
    expect(once).toHaveLength(40)
    expect(once).toBe(twice)
    expect(buildCardExtSignature({ ...args, code: 'RC999' })).not.toBe(once)
  })
})
