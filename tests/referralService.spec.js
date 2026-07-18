import { describe, it, expect } from 'vitest'
import {
  normalizeReferrerCode,
  parseReferrerId,
  normalizeBindSource,
  computeBindingExpiresAt,
  isBindingActive,
  isDuplicateKeyError,
} from '../services/referralService.js'

describe('normalizeReferrerCode', () => {
  it('uppercases and trims valid codes', () => {
    expect(normalizeReferrerCode(' ab12cd ')).toBe('AB12CD')
  })

  it('rejects invalid codes', () => {
    expect(normalizeReferrerCode('')).toBe(null)
    expect(normalizeReferrerCode('bad-code!')).toBe(null)
    expect(normalizeReferrerCode(undefined)).toBe(null)
  })
})

describe('parseReferrerId', () => {
  it('parses positive integers', () => {
    expect(parseReferrerId('42')).toBe(42)
    expect(parseReferrerId(7)).toBe(7)
  })

  it('rejects invalid ids', () => {
    expect(parseReferrerId(0)).toBe(null)
    expect(parseReferrerId(-1)).toBe(null)
    expect(parseReferrerId('abc')).toBe(null)
    expect(parseReferrerId('')).toBe(null)
  })
})

describe('normalizeBindSource', () => {
  it('accepts valid sources', () => {
    expect(normalizeBindSource('code')).toBe('code')
    expect(normalizeBindSource('POSTER')).toBe('poster')
  })

  it('defaults to link when empty', () => {
    expect(normalizeBindSource()).toBe('link')
  })

  it('rejects unknown sources', () => {
    expect(normalizeBindSource('qr')).toBe(null)
  })
})

describe('binding expiry', () => {
  it('uses permanent bindings (null expires_at)', () => {
    expect(computeBindingExpiresAt()).toBe(null)
  })

  it('treats null expires_at as permanently active', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    expect(isBindingActive({ expires_at: null }, now)).toBe(true)
    expect(isBindingActive({ expires_at: '' }, now)).toBe(true)
    expect(isBindingActive({ expires_at: '2099-12-31T00:00:00.000Z' }, now)).toBe(true)
    expect(isBindingActive({ expires_at: '2026-01-01T00:00:00.000Z' }, now)).toBe(false)
    expect(isBindingActive(null, now)).toBe(false)
  })
})

describe('isDuplicateKeyError', () => {
  it('detects mysql duplicate key errors', () => {
    expect(isDuplicateKeyError({ code: 'ER_DUP_ENTRY' })).toBe(true)
    expect(isDuplicateKeyError({ errno: 1062 })).toBe(true)
    expect(isDuplicateKeyError(new Error('other'))).toBe(false)
    expect(isDuplicateKeyError(null)).toBe(false)
  })
})
