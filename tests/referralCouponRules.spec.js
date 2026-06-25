import { describe, it, expect } from 'vitest'
import { evaluateReferralCouponApplicability } from '../services/referralRewardService.js'

describe('evaluateReferralCouponApplicability', () => {
  it('rejects when item subtotal is below coupon face value', () => {
    const result = evaluateReferralCouponApplicability({
      itemsSubtotalYuan: 30,
      orderBaseYuan: 30,
      couponDiscountYuan: 50,
      minOrderYuan: 0,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('商品金额低于优惠券面额')
  })

  it('allows full face value discount when item subtotal meets face value', () => {
    const result = evaluateReferralCouponApplicability({
      itemsSubtotalYuan: 80,
      orderBaseYuan: 80,
      couponDiscountYuan: 50,
      minOrderYuan: 0,
    })
    expect(result.ok).toBe(true)
    expect(result.discountYuan).toBe(50)
  })

  it('does not cap discount below face value when subtotal is sufficient', () => {
    const result = evaluateReferralCouponApplicability({
      itemsSubtotalYuan: 120,
      orderBaseYuan: 120,
      couponDiscountYuan: 50,
      minOrderYuan: 0,
    })
    expect(result.ok).toBe(true)
    expect(result.discountYuan).toBe(50)
  })

  it('enforces min order threshold on order base including shipping', () => {
    const result = evaluateReferralCouponApplicability({
      itemsSubtotalYuan: 100,
      orderBaseYuan: 90,
      couponDiscountYuan: 50,
      minOrderYuan: 100,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('订单满 100 元可用')
  })

  it('rejects invalid coupon amount', () => {
    const result = evaluateReferralCouponApplicability({
      itemsSubtotalYuan: 100,
      orderBaseYuan: 100,
      couponDiscountYuan: 0,
      minOrderYuan: 0,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('优惠券金额无效')
  })
})
