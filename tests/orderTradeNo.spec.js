import { describe, it, expect } from 'vitest'
import {
  buildUserBoundOutTradeNoPrefix,
  generateOutTradeNo,
  resolveUserOutTradeNo,
} from '../utils/orderTradeNo.js'

describe('orderTradeNo', () => {
  it('buildUserBoundOutTradeNoPrefix', () => {
    expect(buildUserBoundOutTradeNoPrefix(42)).toBe('ORD42_')
    expect(buildUserBoundOutTradeNoPrefix(0)).toBeNull()
  })

  it('generateOutTradeNo is user-bound and unique', () => {
    const a = generateOutTradeNo(7)
    const b = generateOutTradeNo(7)
    expect(a).toMatch(/^ORD7_[A-Za-z0-9_-]+$/)
    expect(b).toMatch(/^ORD7_[A-Za-z0-9_-]+$/)
    expect(a).not.toBe(b)
  })

  it('resolveUserOutTradeNo rejects cross-user prefix', () => {
    const r = resolveUserOutTradeNo({ raw: 'ORD99_ABC123', userId: 1 })
    expect(r.error).toBeTruthy()
  })

  it('resolveUserOutTradeNo accepts own prefix', () => {
    const r = resolveUserOutTradeNo({ raw: 'ORD5_MYORDER1', userId: 5 })
    expect(r.outTradeNo).toBe('ORD5_MYORDER1')
    expect(r.generated).toBe(false)
  })

  it('resolveUserOutTradeNo generates when empty', () => {
    const r = resolveUserOutTradeNo({ raw: '', userId: 3 })
    expect(r.outTradeNo).toMatch(/^ORD3_/)
    expect(r.generated).toBe(true)
  })
})
