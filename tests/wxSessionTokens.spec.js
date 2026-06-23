import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import {
  hashRefreshToken,
  generateRefreshToken,
  signWxAccessToken,
  getAccessTokenMeta,
  getRefreshTokenMeta,
} from '../utils/wxSessionTokens.js'

describe('wxSessionTokens', () => {
  it('hashRefreshToken is deterministic', () => {
    const token = 'sample-refresh-token'
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token))
    expect(hashRefreshToken(token)).toHaveLength(64)
  })

  it('generateRefreshToken returns unique opaque strings', () => {
    const a = generateRefreshToken()
    const b = generateRefreshToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(20)
  })

  it('signWxAccessToken includes userId and openid', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-jwt-secret-at-least-32-characters'
    const token = signWxAccessToken({ userId: 42, openid: 'o-test' })
    const decoded = jwt.decode(token)
    expect(decoded.userId).toBe(42)
    expect(decoded.openid).toBe('o-test')
    expect(decoded.exp).toBeTruthy()
  })

  it('getAccessTokenMeta derives expiry fields', () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'vitest-jwt-secret-at-least-32-characters'
    const token = signWxAccessToken({ userId: 1, openid: 'o-test' })
    const meta = getAccessTokenMeta(token)
    expect(meta.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.expiresIn).toBeGreaterThan(0)
  })

  it('getRefreshTokenMeta returns future expiry', () => {
    const meta = getRefreshTokenMeta()
    expect(meta.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(meta.expiresIn).toBeGreaterThan(0)
  })
})
