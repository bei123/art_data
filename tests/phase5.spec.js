import { describe, it, expect } from 'vitest'
import {
  REFERRAL_BRAND,
  buildReferralRuleHighlights,
} from '../utils/referralCopy.js'
import { computeWithdrawCap } from '../services/withdrawService.js'
import { runCommissionSettlementTick } from '../services/commissionSettlementScheduler.js'

describe('REFERRAL_BRAND', () => {
  it('uses unified program naming', () => {
    expect(REFERRAL_BRAND.programName).toBe('艺术推荐官')
    expect(REFERRAL_BRAND.advisorName).toBe('艺术顾问')
    expect(REFERRAL_BRAND.vipName).toBe('VIP收藏家')
  })
})

describe('buildReferralRuleHighlights', () => {
  it('builds seven highlight lines with consistent copy', () => {
    
    const highlights = buildReferralRuleHighlights({
      bindingDays: 365,
      firstReferralBonusYuan: 30,
      newUserCouponYuan: 50,
      newUserCouponValidDays: 30,
      vipSpendThresholdYuan: 5000,
      withdrawPolicy: {
        max_yuan: 200,
        user_daily_limit_yuan: 2000,
      },
    })

    expect(highlights).toHaveLength(7)
    expect(highlights[0]).toContain(REFERRAL_BRAND.shareRewardLabel)
    expect(highlights[2]).toContain(REFERRAL_BRAND.programName)
    expect(highlights[4]).toContain(REFERRAL_BRAND.vipName)
    expect(highlights[5]).toContain(REFERRAL_BRAND.advisorName)
    expect(highlights[6]).toContain('200')
    expect(highlights[6]).toContain('2000')
  })
})

describe('computeWithdrawCap concurrency limits', () => {
  it('caps by per-transaction max when available is higher', () => {
    expect(computeWithdrawCap({
      availableYuan: 1000,
      userTodayYuan: 0,
      merchantTodayYuan: 0,
    })).toBeLessThanOrEqual(200)
  })

  it('caps by remaining daily user limit', () => {
    expect(computeWithdrawCap({
      availableYuan: 500,
      userTodayYuan: 1900,
      merchantTodayYuan: 0,
    })).toBe(100)
  })

  it('returns zero when daily limit exhausted', () => {
    expect(computeWithdrawCap({
      availableYuan: 500,
      userTodayYuan: 2000,
      merchantTodayYuan: 0,
    })).toBe(0)
  })

  it('caps by merchant daily limit', () => {
    expect(computeWithdrawCap({
      availableYuan: 500,
      userTodayYuan: 0,
      merchantTodayYuan: 49950,
    })).toBe(50)
  })
})

describe('runCommissionSettlementTick overlap guard', () => {
  it('exports settlement tick runner', () => {
    expect(typeof runCommissionSettlementTick).toBe('function')
  })
})
