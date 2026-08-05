import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { isPublicAdminRegisterAllowed, requirePublicAdminRegisterEnabled } = require('../utils/publicRegistrationGuard')
const { readWebhookSecret, verifyIntegrationWebhook } = require('../utils/integrationWebhookAuth')
const { shouldExposeErrorDetail, appendClientErrorDetail } = require('../utils/clientErrorDetail')
const { hashSessionToken } = require('../utils/sessionTokenHash')
const { isOriginAllowed } = require('../middleware/corsPolicy')

describe('publicRegistrationGuard', () => {
  const prev = process.env.ALLOW_PUBLIC_ADMIN_REGISTER

  afterEach(() => {
    if (prev === undefined) delete process.env.ALLOW_PUBLIC_ADMIN_REGISTER
    else process.env.ALLOW_PUBLIC_ADMIN_REGISTER = prev
  })

  it('defaults to disabled', () => {
    delete process.env.ALLOW_PUBLIC_ADMIN_REGISTER
    expect(isPublicAdminRegisterAllowed()).toBe(false)
  })

  it('blocks register when disabled', () => {
    delete process.env.ALLOW_PUBLIC_ADMIN_REGISTER
    const json = vi.fn()
    const res = { status: vi.fn(() => ({ json })) }
    const next = vi.fn()
    requirePublicAdminRegisterEnabled({}, res, next)
    expect(res.status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalled()
    expect(next).not.toHaveBeenCalled()
  })
})

describe('integrationWebhookAuth', () => {
  const prev = process.env.ASSET_TRANSFER_WEBHOOK_SECRET

  afterEach(() => {
    if (prev === undefined) delete process.env.ASSET_TRANSFER_WEBHOOK_SECRET
    else process.env.ASSET_TRANSFER_WEBHOOK_SECRET = prev
  })

  it('rejects when secret not configured', () => {
    delete process.env.ASSET_TRANSFER_WEBHOOK_SECRET
    delete process.env.INTEGRATION_WEBHOOK_SECRET
    const middleware = verifyIntegrationWebhook({ envName: 'ASSET_TRANSFER_WEBHOOK_SECRET' })
    const json = vi.fn()
    const res = { status: vi.fn(() => ({ json })) }
    const next = vi.fn()
    middleware({}, res, next)
    expect(res.status).toHaveBeenCalledWith(503)
    expect(next).not.toHaveBeenCalled()
  })

  it('accepts matching header secret', () => {
    process.env.ASSET_TRANSFER_WEBHOOK_SECRET = 'test-secret'
    expect(readWebhookSecret('ASSET_TRANSFER_WEBHOOK_SECRET')).toBe('test-secret')
    const middleware = verifyIntegrationWebhook({ envName: 'ASSET_TRANSFER_WEBHOOK_SECRET' })
    const next = vi.fn()
    middleware({ headers: { 'x-webhook-secret': 'test-secret' } }, {}, next)
    expect(next).toHaveBeenCalled()
  })
})

describe('idcardVerify auth', () => {
  it('requires login', async () => {
    const wxService = require('../services/wxService')
    const result = await wxService.idcardVerify({
      headers: {},
      body: { certName: '张三', certNo: '110101199001011234' },
    })
    expect(result.status).toBe(401)
  })
})

describe('integration routers admin guard', () => {
  it('integration route files use requireAdmin', () => {
    const root = path.join(process.cwd(), 'routes')
    const files = [
      'external-api.js',
      'issuance.js',
      'asset-verify.js',
      'transaction.js',
      'asset-transfer.js',
    ]
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), 'utf8')
      expect(source, file).toMatch(/router\.use\(\.\.\.requireAdmin\)/)
    }
    const assetTransfer = fs.readFileSync(path.join(root, 'asset-transfer.js'), 'utf8')
    expect(assetTransfer).toMatch(/verifyIntegrationWebhook/)
  })
})

describe('clientErrorDetail', () => {
  const prev = process.env.NODE_ENV

  afterEach(() => {
    if (prev === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = prev
  })

  it('hides detail in production', () => {
    process.env.NODE_ENV = 'production'
    expect(shouldExposeErrorDetail()).toBe(false)
    expect(appendClientErrorDetail({ error: 'fail' }, new Error('secret'))).toEqual({ error: 'fail' })
  })

  it('exposes detail outside production', () => {
    process.env.NODE_ENV = 'development'
    const body = appendClientErrorDetail({ error: 'fail' }, new Error('secret'))
    expect(body.detail).toBe('secret')
  })
})

describe('sessionTokenHash', () => {
  it('hashes tokens deterministically', () => {
    const a = hashSessionToken('abc')
    const b = hashSessionToken('abc')
    expect(a).toBe(b)
    expect(a).toHaveLength(64)
  })
})

describe('corsPolicy subdomain wildcard', () => {
  const prev = process.env.CORS_ALLOW_SUBDOMAIN_WILDCARD

  afterEach(() => {
    if (prev === undefined) delete process.env.CORS_ALLOW_SUBDOMAIN_WILDCARD
    else process.env.CORS_ALLOW_SUBDOMAIN_WILDCARD = prev
  })

  it('allows gallery subdomains by default', () => {
    delete process.env.CORS_ALLOW_SUBDOMAIN_WILDCARD
    expect(isOriginAllowed('https://admin.2000gallery.art')).toBe(true)
  })

  it('blocks gallery subdomains when disabled', () => {
    process.env.CORS_ALLOW_SUBDOMAIN_WILDCARD = 'false'
    expect(isOriginAllowed('https://admin.2000gallery.art')).toBe(false)
    expect(isOriginAllowed('http://localhost:5173')).toBe(true)
  })
})

describe('wx route auth', () => {
  it('wx.js applies router-level auth on sensitive routes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'routes/wx.js'), 'utf8')
    expect(source).toMatch(/router\.get\('\/userInfo', \.\.\.wxAuthenticated/)
    expect(source).toMatch(/router\.get\('\/userPhone', \.\.\.wxAuthenticated/)
    expect(source).toMatch(/router\.post\('\/setPassword', \.\.\.wxAuthenticated/)
  })

  it('wxAuthenticated rejects non-wx principals', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'utils/wxRouteAuth.js'), 'utf8')
    expect(source).toMatch(/requireWxUser/)
    expect(source).toMatch(/is_wx_user/)
    expect(source).toMatch(/仅小程序用户可访问/)
  })
})

describe('digital-artworks wespace proxy auth', () => {
  it('requires wx login on wespace proxy routes', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'routes/digital-artworks.js'), 'utf8')
    expect(source).toMatch(/router\.get\('\/order\/product-list', \.\.\.wxAuthenticated/)
    expect(source).toMatch(/router\.post\('\/order\/purchase', \.\.\.wxAuthenticated/)
    expect(source).toMatch(/router\.post\('\/goods\/ver\/list\/v3', \.\.\.wxAuthenticated/)
    expect(source).toMatch(/router\.post\('\/goods\/ver\/details', \.\.\.wxAuthenticated/)
  })
})

describe('localUploads admin role query', () => {
  it('joins roles table instead of users.role column', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'middleware/localUploads.js'), 'utf8')
    expect(source).toMatch(/JOIN roles r ON u\.role_id = r\.id/)
    expect(source).not.toMatch(/SELECT role FROM users/)
  })
})

describe('userPhone masking', () => {
  it('masks phone unless purpose is real_name', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'services/wxService.js'), 'utf8')
    expect(source).toMatch(/purpose === 'real_name'/)
    expect(source).toMatch(/exposeFullPhone \? phone : maskPhone\(phone\)/)
  })
})

describe('pay callback logging', () => {
  it('does not log decrypted callback payloads with console.log', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'services/payService.js'), 'utf8')
    expect(source).not.toMatch(/console\.log\('解密后回调数据/)
    expect(source).not.toMatch(/console\.log\('【退款回调】解密后回调数据/)
  })
})

describe('low severity fixes', () => {
  it('transaction stub routes return 501 instead of mock data', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'routes/transaction.js'), 'utf8')
    expect(source).toMatch(/notImplementedBody\('交易记录详情'\)/)
    expect(source).not.toMatch(/WSAbBZmQpgt/)
    expect(source).not.toMatch(/your-domain\.com\/downloads/)
  })

  it('digital-artworks health is mounted once in index.js', () => {
    const indexSource = fs.readFileSync(path.join(process.cwd(), 'index.js'), 'utf8')
    const routerSource = fs.readFileSync(path.join(process.cwd(), 'routes/digital-artworks.js'), 'utf8')
    expect(indexSource).toMatch(/\/api\/digital-artworks\/health/)
    expect(routerSource).not.toMatch(/router\.get\('\/health'/)
  })

  it('wx login and refresh have dedicated rate limiters', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'routes/wx.js'), 'utf8')
    expect(source).toMatch(/router\.post\('\/login', wxLoginLimiter/)
    expect(source).toMatch(/router\.post\('\/refresh', wxRefreshLimiter/)
  })

  it('stripPublicFields strips internal keys', () => {
    const { stripPublicFields } = require('../utils/publicApiSanitizer')
    const out = stripPublicFields({
      id: 1,
      title: 'x',
      is_hidden: true,
      fetched_at: '2024-01-01',
      wespace: { legacy_details_json: { secret: 1 }, goods_ver_details: {} },
    })
    expect(out.is_hidden).toBeUndefined()
    expect(out.fetched_at).toBeUndefined()
    expect(out.wespace.legacy_details_json).toBeUndefined()
    expect(out.wespace.goods_ver_details).toEqual({})
    expect(out.id).toBe(1)
  })

  it('wxService avoids raw detail: err.message in production responses', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'services/wxService.js'), 'utf8')
    expect(source).toMatch(/function fail500\(/)
    expect(source).not.toMatch(/detail: err\.message/)
  })

  it('wespace proxy validates usn ownership', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'routes/digital-artworks.js'), 'utf8')
    expect(source).toMatch(/assertUsnOwnedByWxUser/)
  })

  it('userPhone requires purpose=real_name for full phone', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'services/wxService.js'), 'utf8')
    expect(source).toMatch(/purpose === 'real_name'/)
  })
})
