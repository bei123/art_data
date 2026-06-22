import { describe, it, expect } from 'vitest'
import {
  normalizeCartItemShape,
  normalizeSingleItemFromBody,
  hasPhysicalItems,
  roundYuan,
  amountsMatch,
  cartItemsFingerprint,
  buildFeeBreakdown,
  getDefaultExpressTypeId,
} from '../services/checkoutPricing.js'

describe('checkoutPricing', () => {
  it('normalizeCartItemShape validates cart items', () => {
    expect(normalizeCartItemShape({ type: 'right', right_id: 1, quantity: 2 })).toEqual({
      type: 'right',
      quantity: 2,
      right_id: 1,
    })

    expect(normalizeCartItemShape({ type: 'bad', quantity: 1 }).error).toBeTruthy()
    expect(normalizeCartItemShape({ type: 'right', right_id: 0, quantity: 1 }).error).toBeTruthy()
  })

  it('normalizeSingleItemFromBody validates single order payload', () => {
    const item = normalizeSingleItemFromBody({
      type: 'artwork',
      artwork_id: 9,
      quantity: 1,
    })
    expect(item).toEqual({ type: 'artwork', quantity: 1, artwork_id: 9 })
  })

  it('hasPhysicalItems detects physical goods', () => {
    expect(hasPhysicalItems([{ type: 'digital', digital_artwork_id: '1', quantity: 1 }])).toBe(false)
    expect(hasPhysicalItems([{ type: 'right', right_id: 1, quantity: 1 }])).toBe(true)
  })

  it('buildFeeBreakdown includes shipping and discount', () => {
    const fee = buildFeeBreakdown({
      itemsSubtotalYuan: 100,
      shippingFeeYuan: 12,
      discountYuan: 10,
    })
    expect(fee.items_subtotal_yuan).toBe(100)
    expect(fee.shipping_fee_yuan).toBe(12)
    expect(fee.order_total_before_discount_yuan).toBe(112)
    expect(fee.amount_payable_yuan).toBe(102)
  })

  it('amountsMatch compares yuan with epsilon', () => {
    expect(amountsMatch(10, 10.005)).toBe(true)
    expect(amountsMatch(10, 10.02)).toBe(false)
  })

  it('cartItemsFingerprint is order-independent', () => {
    const a = [
      { type: 'right', right_id: 2, quantity: 1 },
      { type: 'digital', digital_artwork_id: 'x', quantity: 1 },
    ]
    const b = [
      { type: 'digital', digital_artwork_id: 'x', quantity: 1 },
      { type: 'right', right_id: 2, quantity: 1 },
    ]
    expect(cartItemsFingerprint(a)).toBe(cartItemsFingerprint(b))
  })

  it('roundYuan rounds to two decimals', () => {
    expect(roundYuan(1.005)).toBe(1)
    expect(roundYuan(1.006)).toBe(1.01)
  })

  it('getDefaultExpressTypeId defaults to 2', () => {
    const prev = process.env.SF_DEFAULT_EXPRESS_TYPE_ID
    delete process.env.SF_DEFAULT_EXPRESS_TYPE_ID
    expect(getDefaultExpressTypeId()).toBe(2)
    process.env.SF_DEFAULT_EXPRESS_TYPE_ID = prev
  })

  it('computeCartShippingMetrics sums right weight and volume', () => {
    const { computeCartShippingMetrics } = require('../services/checkoutPricing.js')
    const goodsMap = new Map([
      ['right_1', { weight_kg: 0.5, length_cm: 30, width_cm: 20, height_cm: 10 }],
      ['right_2', { weight_kg: 1.2 }],
    ])
    const metrics = computeCartShippingMetrics([
      { type: 'right', right_id: 1, quantity: 2 },
      { type: 'right', right_id: 2, quantity: 1 },
      { type: 'digital', digital_artwork_id: 'x', quantity: 1 },
    ], goodsMap)

    expect(metrics.weightKg).toBe(2.2)
    expect(metrics.volumeCm3).toBe(12000)
  })

  it('buildShippingMetricsFromPhysicalItems aggregates order items for logistics', () => {
    const { buildShippingMetricsFromPhysicalItems } = require('../services/checkoutPricing.js')
    const metrics = buildShippingMetricsFromPhysicalItems([
      {
        type: 'right',
        right_id: 3,
        quantity: 1,
        length_cm: 40,
        width_cm: 30,
        height_cm: 10,
        weight_kg: 0.8,
      },
    ])

    expect(metrics.totalWeight).toBe(0.8)
    expect(metrics.totalVolume).toBe(12000)
    expect(metrics.totalLength).toBe(40)
    expect(metrics.totalWidth).toBe(30)
    expect(metrics.totalHeight).toBe(10)
  })
})
