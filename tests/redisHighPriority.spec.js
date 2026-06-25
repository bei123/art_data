import { describe, it, expect } from 'vitest'
import { buildExternalUserRedisCachePayload } from '../utils/externalUserRedisCache.js'

describe('buildExternalUserRedisCachePayload', () => {
  it('excludes token and secret fields from redis cache payload', () => {
    const payload = buildExternalUserRedisCachePayload({
      id: 1,
      wx_user_id: 9,
      usn: 'u001',
      external_user_id: 'ext-1',
      username: 'alice',
      truename: 'Alice',
      nickname: 'A',
      mobile: '13800000000',
      avatar: 'https://example.com/a.png',
      access_token: 'should-not-appear',
      refresh_token: 'should-not-appear',
      token: 'should-not-appear',
      ws_token: 'should-not-appear',
      ws_stoken: 'should-not-appear',
      im_token: 'should-not-appear',
      expire: 123,
      app_type: 1,
      app_type_name: 'app',
      set_password: false,
      node_org: null,
      identity_authentication: 1,
      postcode: '',
      nation: '',
      invite_code: '',
      channel: '',
      client_id: '',
      privileges: [],
      chain_status: 1,
      status: 1,
      id_card_no: '',
    })

    expect(payload.usn).toBe('u001')
    expect(payload).not.toHaveProperty('access_token')
    expect(payload).not.toHaveProperty('refresh_token')
    expect(payload).not.toHaveProperty('token')
    expect(payload).not.toHaveProperty('ws_token')
    expect(payload).not.toHaveProperty('ws_stoken')
    expect(payload).not.toHaveProperty('im_token')
  })
})
