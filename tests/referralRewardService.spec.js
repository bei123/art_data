import { describe, it, expect } from 'vitest'
import { validateWithdrawAmount, mapWechatStateToWithdrawalStatus } from '../services/withdrawService.js'
import { FIRST_REFERRAL_BONUS_YUAN } from '../services/referralRewardService.js'

describe('mapWechatStateToWithdrawalStatus', () => {
  it('maps user confirm states to await_confirm', async () => {
    expect(await mapWechatStateToWithdrawalStatus('WAIT_USER_CONFIRM')).toBe('await_confirm')
    expect(await mapWechatStateToWithdrawalStatus('TRANSFERING')).toBe('await_confirm')
  })

  it('maps terminal states', async () => {
    expect(await mapWechatStateToWithdrawalStatus('SUCCESS')).toBe('success')
    expect(await mapWechatStateToWithdrawalStatus('FAIL')).toBe('failed')
    expect(await mapWechatStateToWithdrawalStatus('CANCELLED')).toBe('failed')
  })
})

describe('validateWithdrawAmount', () => {
  it('allows any positive amount when min is 0', () => {
    const r = validateWithdrawAmount(1, 100)
    expect(r.ok).toBe(true)
    expect(r.amount).toBe(1)
  })

  it('rejects zero and negative amounts', () => {
    expect(validateWithdrawAmount(0, 100).ok).toBe(false)
    expect(validateWithdrawAmount(-1, 100).ok).toBe(false)
  })

  it('rejects amount greater than available', () => {
    expect(validateWithdrawAmount(50, 20).ok).toBe(false)
  })
})

describe('FIRST_REFERRAL_BONUS_YUAN', () => {
  it('defaults to 30 yuan', () => {
    expect(FIRST_REFERRAL_BONUS_YUAN).toBe(30)
  })
})
