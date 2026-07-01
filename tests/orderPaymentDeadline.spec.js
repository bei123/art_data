import { describe, it, expect, afterEach } from 'vitest'
import {
  getUnpaidOrderDeadlineMinutes,
  getPaymentDeadlineMs,
  buildWechatPayTimeExpire,
} from '../utils/orderPaymentDeadline.js'

describe('orderPaymentDeadline', () => {
  const prevAuto = process.env.ORDER_UNPAID_AUTO_CLOSE_MINUTES
  const prevWx = process.env.WX_SUBSCRIBE_PAYMENT_DEADLINE_MINUTES

  afterEach(() => {
    process.env.ORDER_UNPAID_AUTO_CLOSE_MINUTES = prevAuto
    process.env.WX_SUBSCRIBE_PAYMENT_DEADLINE_MINUTES = prevWx
  })

  it('defaults to 30 minutes', () => {
    delete process.env.ORDER_UNPAID_AUTO_CLOSE_MINUTES
    delete process.env.WX_SUBSCRIBE_PAYMENT_DEADLINE_MINUTES
    expect(getUnpaidOrderDeadlineMinutes()).toBe(30)
  })

  it('prefers ORDER_UNPAID_AUTO_CLOSE_MINUTES over wx subscribe env', () => {
    process.env.WX_SUBSCRIBE_PAYMENT_DEADLINE_MINUTES = '45'
    process.env.ORDER_UNPAID_AUTO_CLOSE_MINUTES = '20'
    expect(getUnpaidOrderDeadlineMinutes()).toBe(20)
  })

  it('builds RFC3339 time_expire for wechat pay', () => {
    const value = buildWechatPayTimeExpire(30)
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)
  })

  it('computes deadline from createdAt', () => {
    const created = new Date('2026-07-01T10:00:00+08:00')
    const deadline = getPaymentDeadlineMs(created, 30)
    expect(deadline - created.getTime()).toBe(30 * 60 * 1000)
  })
})
