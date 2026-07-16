import { describe, it, expect } from 'vitest'
import {
  evaluateReferralCouponApplicability,
  resolveReferralCouponDiscount,
} from '../services/referralRewardService.js'
import { sanitizeStockName, yuanToCents, formatRfc3339, clampMaxCoupons } from '../services/wechatFavorService.js'

describe('evaluateReferralCouponApplicability (legacy local coupons removed)', () => {
  it('always rejects local coupon application at checkout', () => {
    const result = evaluateReferralCouponApplicability({
      itemsSubtotalYuan: 100,
      orderBaseYuan: 100,
      couponDiscountYuan: 50,
      minOrderYuan: 0,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('微信支付代金券')
  })
})

describe('resolveReferralCouponDiscount', () => {
  it('returns zero discount without reading local coupons', async () => {
    const result = await resolveReferralCouponDiscount()
    expect(result.discountYuan).toBe(0)
    expect(result.coupon).toBeNull()
  })
})

describe('wechatFavorService helpers', () => {
  it('converts yuan to cents', () => {
    expect(yuanToCents(50)).toBe(5000)
    expect(yuanToCents('12.34')).toBe(1234)
  })

  it('sanitizes stock name to at most 9 chars without illegal punctuation', () => {
    expect(sanitizeStockName('新人礼包优惠券活动')).toHaveLength(9)
    expect(sanitizeStockName('测试_券|名')).toBe('测试券名')
  })

  it('formats rfc3339 as China +08:00 regardless of host timezone offset labeling', () => {
    const s = formatRfc3339(new Date('2026-07-16T01:00:00.000Z'))
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+08:00$/)
    // 01:00 UTC → 09:00 China
    expect(s.startsWith('2026-07-16T09:00:00')).toBe(true)
  })

  it('clamps max_coupons to WeChat limits [5, 10_000_000]', () => {
    expect(clampMaxCoupons(1)).toBe(5)
    expect(clampMaxCoupons(100)).toBe(100)
    expect(clampMaxCoupons(99999999)).toBe(10000000)
  })
})
