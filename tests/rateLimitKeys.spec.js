import { describe, it, expect } from 'vitest'
import { rateLimitIpKey, rateLimitUserOrIpKey } from '../utils/rateLimitKeys.js'

describe('rateLimitKeys', () => {
  it('normalizes IPv6 addresses via ipKeyGenerator', () => {
    const key = rateLimitIpKey({ ip: '2001:db8::1' })
    expect(typeof key).toBe('string')
    expect(key.length).toBeGreaterThan(0)
  })

  it('prefers user id over ip', () => {
    const req = { ip: '127.0.0.1', user: { id: 42 } }
    expect(rateLimitUserOrIpKey('wx-phone', req)).toBe('wx-phone:user:42')
  })

  it('falls back to ip key when user is absent', () => {
    const req = { ip: '127.0.0.1' }
    expect(rateLimitUserOrIpKey('wx-phone', req)).toMatch(/^wx-phone:ip:/)
  })
})
