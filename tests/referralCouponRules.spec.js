import { describe, it, expect } from 'vitest'
import {
  evaluateReferralCouponApplicability,
  resolveReferralCouponDiscount,
} from '../services/referralRewardService.js'
import { sanitizeStockName, yuanToCents } from '../services/wechatFavorService.js'

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
})
