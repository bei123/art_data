import { describe, expect, it } from 'vitest'
import { buildWechatOrderConfirmFields, isValidWechatTransactionId } from '../utils/wechatOrderConfirm.js'

describe('wechatOrderConfirm helpers', () => {
  it('rejects masked transaction_id', () => {
    expect(isValidWechatTransactionId('4200****1234')).toBe(false)
    expect(isValidWechatTransactionId('4200001234567890')).toBe(true)
  })

  it('enables confirm when paid physical order has shipment', () => {
    const result = buildWechatOrderConfirmFields({
      order: { out_trade_no: 'ORDER123', transaction_id: '4200001234567890' },
      tradeState: 'SUCCESS',
      fulfillmentStatus: { code: 'shipped' },
      items: [{ type: 'artwork' }],
      shipment: { waybill_id: 'SF123', status: 'active' },
      merchantId: '1230000109',
    })
    expect(result.can_confirm_receipt).toBe(true)
    expect(result.wechat_order_confirm).toEqual({
      enabled: true,
      transaction_id: '4200001234567890',
      merchant_id: '1230000109',
      merchant_trade_no: 'ORDER123',
    })
  })

  it('disables confirm when order is already received', () => {
    const result = buildWechatOrderConfirmFields({
      order: { out_trade_no: 'ORDER123', transaction_id: '4200001234567890' },
      tradeState: 'SUCCESS',
      fulfillmentStatus: { code: 'received' },
      items: [{ type: 'right' }],
      shipment: { waybill_id: 'SF123', status: 'active' },
      merchantId: '1230000109',
    })
    expect(result.can_confirm_receipt).toBe(false)
    expect(result.wechat_order_confirm.enabled).toBe(false)
  })
})
