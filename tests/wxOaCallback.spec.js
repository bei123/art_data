import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { buildOaSignature } from '../utils/wxOaCrypto.js'
import { handleOaCallbackVerify } from '../services/wxCardEventService.js'

describe('handleOaCallbackVerify', () => {
  const previous = {}

  beforeEach(() => {
    for (const key of [
      'WECHAT_OA_APPID',
      'WECHAT_OA_TOKEN',
      'WECHAT_OA_AES_KEY',
      'WECHAT_OA_CALLBACK_ENABLED',
    ]) {
      previous[key] = process.env[key]
    }
    process.env.WECHAT_OA_APPID = 'wx_test_appid'
    process.env.WECHAT_OA_TOKEN = 'url_token'
    process.env.WECHAT_OA_CALLBACK_ENABLED = 'true'
    delete process.env.WECHAT_OA_AES_KEY
  })

  afterEach(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  it('returns echostr when signature is valid', () => {
    const timestamp = '1710000000'
    const nonce = 'n1'
    const echostr = 'hello-echo'
    const signature = buildOaSignature({
      token: 'url_token',
      timestamp,
      nonce,
    })
    expect(
      handleOaCallbackVerify({ signature, timestamp, nonce, echostr })
    ).toBe(echostr)
  })

  it('rejects invalid signature', () => {
    expect(() =>
      handleOaCallbackVerify({
        signature: 'bad',
        timestamp: '1',
        nonce: '2',
        echostr: 'x',
      })
    ).toThrow(/signature/)
  })

  it('rejects when callback disabled', () => {
    process.env.WECHAT_OA_CALLBACK_ENABLED = 'false'
    expect(() =>
      handleOaCallbackVerify({
        signature: 'x',
        timestamp: '1',
        nonce: '2',
        echostr: 'x',
      })
    ).toThrow(/未启用/)
  })
})
