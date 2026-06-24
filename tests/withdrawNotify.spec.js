import { describe, it, expect } from 'vitest'
import { normalizeTransferBill } from '../services/wechatTransferService.js'
import { mapWechatStateToWithdrawalStatus } from '../services/withdrawService.js'

describe('normalizeTransferBill', () => {
  it('parses transfer notify payload fields', () => {
    const bill = normalizeTransferBill({
      out_bill_no: 'WD123',
      transfer_bill_no: '1330000071100999991182020050700019480001',
      state: 'SUCCESS',
      transfer_amount: 2000,
      mch_id: '1900001109',
      openid: 'o-test',
      fail_reason: null,
      update_time: '2023-08-15T20:33:22+08:00',
    })

    expect(bill.outBillNo).toBe('WD123')
    expect(bill.transferBillNo).toBe('1330000071100999991182020050700019480001')
    expect(bill.state).toBe('SUCCESS')
    expect(bill.transferAmount).toBe(2000)
    expect(bill.mchId).toBe('1900001109')
  })
})

describe('mapWechatStateToWithdrawalStatus notify states', () => {
  it('maps cancelled notify to failed withdrawal status', async () => {
    expect(await mapWechatStateToWithdrawalStatus('CANCELLED')).toBe('failed')
  })
})
