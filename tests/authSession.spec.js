import { describe, it, expect } from 'vitest'
import { extractBearerToken } from '../utils/sessionAuth.js'

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
