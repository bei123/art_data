import { describe, it, expect } from 'vitest'
import { extractBearerToken, resolveSessionTable } from '../utils/sessionAuth.js'

describe('extractBearerToken', () => {
  it('parses Bearer token', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi')
  })

  it('rejects missing or malformed headers', () => {
    expect(extractBearerToken(undefined)).toBe(null)
    expect(extractBearerToken('Basic abc')).toBe(null)
    expect(extractBearerToken('Bearer')).toBe(null)
  })
})

describe('resolveSessionTable', () => {
  it('uses wx_user_sessions for WeChat JWT', () => {
    expect(resolveSessionTable({ userId: 1, openid: 'o-test' })).toBe('wx_user_sessions')
  })

  it('uses user_sessions for admin JWT', () => {
    expect(resolveSessionTable({ userId: 1 })).toBe('user_sessions')
  })
})
