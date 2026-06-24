import { describe, it, expect } from 'vitest'
import {
  matchRateRule,
  calculateCommissionAmount,
  resolveCommissionRates,
  roundMoney,
} from '../services/commissionService.js'
import { USER_TIERS } from '../services/userTierService.js'

const sampleRules = [
  { product_type: 'right', min_price: 0, max_price: 298.99, base_rate: 0.1, settlement_days: 7, is_active: 1 },
  { product_type: 'right', min_price: 299, max_price: null, base_rate: 0.12, settlement_days: 7, is_active: 1 },
  { product_type: 'digital', min_price: 99, max_price: 198.99, base_rate: 0.15, settlement_days: 7, is_active: 1 },
]

describe('matchRateRule', () => {
  it('matches price band for right products', () => {
    const rule = matchRateRule(sampleRules.filter((r) => r.product_type === 'right'), 150)
    expect(rule.base_rate).toBe(0.1)
  })

  it('matches open-ended max price', () => {
    const rule = matchRateRule(sampleRules.filter((r) => r.product_type === 'right'), 5000)
    expect(rule.base_rate).toBe(0.12)
  })

  it('returns null when no rule matches', () => {
    expect(matchRateRule([], 100)).toBe(null)
  })
})

describe('calculateCommissionAmount', () => {
  it('applies rate and rounds to cents', () => {
    expect(calculateCommissionAmount({ lineAmountYuan: 1000, baseRate: 0.1 })).toBe(100)
    expect(calculateCommissionAmount({ lineAmountYuan: 99.99, baseRate: 0.15 })).toBe(15)
  })

  it('adds VIP bonus rate', () => {
    expect(calculateCommissionAmount({
      lineAmountYuan: 1000,
      baseRate: 0.1,
      bonusRate: 0.02,
    })).toBe(120)
  })

  it('caps commission per item', () => {
    expect(calculateCommissionAmount({
      lineAmountYuan: 100000,
      baseRate: 0.15,
      capYuan: 5000,
    })).toBe(5000)
  })

  it('returns zero for invalid input', () => {
    expect(calculateCommissionAmount({ lineAmountYuan: 0, baseRate: 0.1 })).toBe(0)
    expect(calculateCommissionAmount({ lineAmountYuan: 100, baseRate: -1 })).toBe(0)
  })
})

describe('resolveCommissionRates', () => {
  it('adds VIP bonus on top of base rate', () => {
    const rates = resolveCommissionRates({
      tier: USER_TIERS.VIP_COLLECTOR,
      advisorRate: null,
      matchedRule: { base_rate: 0.1, settlement_days: 7 },
    })
    expect(rates.final_rate).toBeCloseTo(0.12, 4)
    expect(rates.bonus_rate).toBe(0.02)
  })

  it('uses art advisor independent rate', () => {
    const rates = resolveCommissionRates({
      tier: USER_TIERS.ART_ADVISOR,
      advisorRate: 0.2,
      matchedRule: { base_rate: 0.1, settlement_days: 15 },
    })
    expect(rates.final_rate).toBe(0.2)
    expect(rates.bonus_rate).toBe(0)
  })
})

describe('roundMoney', () => {
  it('rounds to two decimal places', () => {
    expect(roundMoney(1.006)).toBe(1.01)
    expect(roundMoney(1.004)).toBe(1)
  })
})
