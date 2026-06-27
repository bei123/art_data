import { describe, it, expect } from 'vitest'
import { SESSION_TOKEN_MIN_WIDTH } from '../utils/sessionStorageSchema.js'

describe('sessionStorageSchema', () => {
  it('requires JWT-safe token column width', () => {
    expect(SESSION_TOKEN_MIN_WIDTH).toBeGreaterThanOrEqual(512)
  })
})
