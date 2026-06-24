import { describe, it, expect } from 'vitest'
import {
  normalizeReferrerCode,
  parseReferrerId,
  normalizeBindSource,
  computeBindingExpiresAt,
  isBindingActive,
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
  it('computes expiry based on binding days', () => {
    const from = new Date('2026-01-01T12:00:00.000Z')
    const expires = computeBindingExpiresAt(from)
    const diffDays = Math.round((expires.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
    expect(diffDays).toBe(365)
  })

  it('detects active bindings', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    expect(isBindingActive({ expires_at: '2026-12-31T00:00:00.000Z' }, now)).toBe(true)
    expect(isBindingActive({ expires_at: '2026-01-01T00:00:00.000Z' }, now)).toBe(false)
    expect(isBindingActive(null, now)).toBe(false)
  })
})
