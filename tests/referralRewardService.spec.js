import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  validateWithdrawAmount,
  mapWechatStateToWithdrawalStatus,
  shouldTransferOnUserRequest,
  isAdminApprovalRequiredForTransfer,
  computeWithdrawCap,
  MAX_WITHDRAW_YUAN,
  USER_DAILY_WITHDRAW_LIMIT_YUAN,
} from '../services/withdrawService.js'
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

  it('rejects amount above default single transfer cap', () => {
    expect(validateWithdrawAmount(201, 500).ok).toBe(false)
    expect(validateWithdrawAmount(200, 500).ok).toBe(true)
  })
})

describe('computeWithdrawCap', () => {
  it('caps by single, user daily, and available balance', () => {
    expect(computeWithdrawCap({
      availableYuan: 1500,
      userTodayYuan: 0,
      merchantTodayYuan: 0,
    })).toBe(200)

    expect(computeWithdrawCap({
      availableYuan: 1500,
      userTodayYuan: 1900,
      merchantTodayYuan: 0,
    })).toBe(100)

    expect(computeWithdrawCap({
      availableYuan: 80,
      userTodayYuan: 0,
      merchantTodayYuan: 0,
    })).toBe(80)
  })

  it('exposes default wechat-aligned limits', () => {
    expect(MAX_WITHDRAW_YUAN).toBe(200)
    expect(USER_DAILY_WITHDRAW_LIMIT_YUAN).toBe(2000)
  })
})

describe('FIRST_REFERRAL_BONUS_YUAN', () => {
  it('defaults to 30 yuan', () => {
    expect(FIRST_REFERRAL_BONUS_YUAN).toBe(30)
  })
})

describe('withdraw transfer policy', () => {
  const prevAuto = process.env.WX_WITHDRAW_AUTO_TRANSFER
  const prevAdmin = process.env.WX_WITHDRAW_REQUIRE_ADMIN_APPROVAL

  afterEach(() => {
    process.env.WX_WITHDRAW_AUTO_TRANSFER = prevAuto
    process.env.WX_WITHDRAW_REQUIRE_ADMIN_APPROVAL = prevAdmin
  })

  it('does not transfer on user request when auto transfer is off', () => {
    process.env.WX_WITHDRAW_AUTO_TRANSFER = 'false'
    process.env.WX_WITHDRAW_REQUIRE_ADMIN_APPROVAL = 'false'
    expect(shouldTransferOnUserRequest()).toBe(false)
  })

  it('waits for admin when admin approval is required', () => {
    process.env.WX_WITHDRAW_REQUIRE_ADMIN_APPROVAL = 'true'
    expect(isAdminApprovalRequiredForTransfer()).toBe(true)
    expect(shouldTransferOnUserRequest()).toBe(false)
  })
})
