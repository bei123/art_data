import { describe, it, expect } from 'vitest'

// 与 wxService 中逻辑一致，防止回归泄露 hash/token
function maskPhone(phone) {
  if (!phone || typeof phone !== 'string') return null
  const trimmed = phone.trim()
  if (trimmed.length < 7) return null
  return `${trimmed.substring(0, 3)}****${trimmed.substring(trimmed.length - 4)}`
}

function formatWxUserProfile(row) {
  return {
    id: row.id,
    openid: row.openid,
    nickname: row.nickname,
    avatar: row.avatar,
    phone: maskPhone(row.phone),
    has_password: Boolean(row.has_password),
    created_at: row.created_at,
    updated_at: row.updated_at,
    usn: row.usn || null,
  }
}

describe('wx user profile formatting', () => {
  it('masks phone and never exposes password_hash or external token', () => {
    const profile = formatWxUserProfile({
      id: 1,
      openid: 'o-test',
      nickname: 'n',
      avatar: 'https://example.com/a.png',
      phone: '13812345678',
      has_password: 1,
      created_at: '2024-01-01',
      updated_at: '2024-01-02',
      usn: 'usn-abc',
      password_hash: 'should-not-appear',
      token: 'secret-token',
    })

    expect(profile.phone).toBe('138****5678')
    expect(profile.has_password).toBe(true)
    expect(profile.usn).toBe('usn-abc')
    expect(profile).not.toHaveProperty('password_hash')
    expect(profile).not.toHaveProperty('token')
  })
})
