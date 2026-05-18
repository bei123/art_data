import { describe, it, expect, beforeEach, afterEach } from 'vitest'

describe('signQiniuPrivateImageUrl', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    process.env.QINIU_ACCESS_KEY = 'test_ak'
    process.env.QINIU_SECRET_KEY = 'test_sk'
    process.env.WMS_IMAGE_CDN_ORIGIN = 'http://qn.example.com'
    delete require.cache[require.resolve('../config/qiniuWms.js')]
  })

  afterEach(() => {
    Object.assign(process.env, envBackup)
    delete require.cache[require.resolve('../config/qiniuWms.js')]
  })

  it('appends imageView2 before e and token', () => {
    const { signQiniuPrivateImageUrl } = require('../config/qiniuWms.js')
    const url = signQiniuPrivateImageUrl('rb/a.jpg', 'imageView2/2/w/400')
    expect(url).toMatch(/^http:\/\/qn\.example\.com\/rb\/a\.jpg\?imageView2/)
    expect(url).toMatch(/&e=\d+&token=test_ak:/)
    const qIdx = url.indexOf('?')
    const eIdx = url.indexOf('&e=')
    const tokenIdx = url.indexOf('&token=')
    expect(qIdx).toBeGreaterThan(0)
    expect(eIdx).toBeGreaterThan(qIdx)
    expect(tokenIdx).toBeGreaterThan(eIdx)
  })

  it('returns empty when AK/SK missing', () => {
    delete process.env.QINIU_ACCESS_KEY
    delete require.cache[require.resolve('../config/qiniuWms.js')]
    const { signQiniuPrivateImageUrl } = require('../config/qiniuWms.js')
    expect(signQiniuPrivateImageUrl('rb/a.jpg', 'imageView2/2/w/100')).toBe('')
  })
})
