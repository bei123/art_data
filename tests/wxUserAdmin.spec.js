import { describe, it, expect } from 'vitest'
import {
  PURGE_CONFIRM_PHRASE,
  validatePurgeRequest,
} from '../services/wxUserAdminService.js'

describe('validatePurgeRequest', () => {
  it('requires matching user id and confirm phrase', () => {
    const ok = validatePurgeRequest({
      userId: 42,
      confirmUserId: 42,
      confirmPhrase: PURGE_CONFIRM_PHRASE,
    })
    expect(ok).toEqual({ userId: 42 })
  })

  it('rejects mismatched confirm id', () => {
    const result = validatePurgeRequest({
      userId: 42,
      confirmUserId: 43,
      confirmPhrase: PURGE_CONFIRM_PHRASE,
    })
    expect(result.error).toBe('确认用户 ID 不一致')
  })

  it('rejects wrong confirm phrase', () => {
    const result = validatePurgeRequest({
      userId: 1,
      confirmUserId: 1,
      confirmPhrase: '删除',
    })
    expect(result.error).toContain(PURGE_CONFIRM_PHRASE)
  })

  it('rejects invalid user id', () => {
    const result = validatePurgeRequest({
      userId: 'abc',
      confirmUserId: 'abc',
      confirmPhrase: PURGE_CONFIRM_PHRASE,
    })
    expect(result.error).toBe('无效的用户 ID')
  })
})
