import { describe, it, expect } from 'vitest'
import {
  isVipEarlyAccessActive,
  isVipTier,
} from '../services/vipEarlyAccessService.js'
import { NEW_USER_COUPON_YUAN } from '../services/referralRewardService.js'

describe('isVipEarlyAccessActive', () => {
  it('returns false when flag is off', () => {
    expect(isVipEarlyAccessActive({ vip_early_access: 0 })).toBe(false)
  })

  it('returns true when flag is on and no deadline', () => {
    expect(isVipEarlyAccessActive({ vip_early_access: 1 })).toBe(true)
  })

  it('returns false after deadline', () => {
    const past = new Date(Date.now() - 60_000).toISOString()
    expect(isVipEarlyAccessActive({ vip_early_access: 1, vip_early_until: past })).toBe(false)
  })
})

describe('isVipTier', () => {
  it('recognizes vip and advisor tiers', () => {
    expect(isVipTier('vip_collector')).toBe(true)
    expect(isVipTier('art_advisor')).toBe(true)
    expect(isVipTier('recommender')).toBe(false)
  })
})

describe('NEW_USER_COUPON_YUAN', () => {
  it('defaults to 50 yuan', () => {
    expect(NEW_USER_COUPON_YUAN).toBe(50)
  })
})
