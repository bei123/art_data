import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseApiSignClients,
  signApiRequest,
  resolveRequestBodyForSign,
} from '../utils/apiRequestSign.js'
import {
  createApiRequestSignMiddleware,
  registerApiSignNonce,
} from '../middleware/apiRequestSign.js'

const TEST_CLIENTS = parseApiSignClients('admin-web:test-admin-secret,wx-mini:test-wx-secret')

function createMockRes() {
  const res = {
    statusCode: 200,
    body: null,
  }
  res.status = (code) => {
    res.statusCode = code
    return res
  }
  res.json = (body) => {
    res.body = body
    return res
  }
  return res
}

function createSignedRequest({
  method = 'GET',
  path = '/api/merchants',
  query = {},
  body,
  apiKey = 'wx-mini',
  secret = 'test-wx-secret',
}) {
  const rawBody = body == null ? undefined : JSON.stringify(body)
  const signed = signApiRequest({
    method,
    path,
    query,
    body: rawBody ?? '',
    apiKey,
    secret,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: crypto.randomUUID(),
  })

  return {
    method,
    path,
    query,
    body,
    rawBody: rawBody == null ? undefined : Buffer.from(rawBody, 'utf8'),
    headers: signed.headers,
    requestId: 'test-request-id',
  }
}

describe('apiRequestSign middleware', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('resolveRequestBodyForSign prefers rawBody over parsed body', () => {
    const rawBody = Buffer.from('{"a":1}', 'utf8')
    expect(resolveRequestBodyForSign({ method: 'POST', rawBody, body: { a: 2 } })).toBe(rawBody)
    expect(resolveRequestBodyForSign({ method: 'GET', rawBody, body: { a: 2 } })).toBe('')
  })

  it('registerApiSignNonce uses setNxEx and detects replay', async () => {
    const redis = {
      setNxEx: vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    }

    const first = await registerApiSignNonce({
      redis,
      apiKey: 'wx-mini',
      nonce: 'nonce-1',
      ttlSec: 600,
    })
    const second = await registerApiSignNonce({
      redis,
      apiKey: 'wx-mini',
      nonce: 'nonce-1',
      ttlSec: 600,
    })

    expect(first).toEqual({ ok: true, replay: false })
    expect(second).toEqual({ ok: true, replay: true })
    expect(redis.setNxEx).toHaveBeenCalledWith('api_sign:nonce:wx-mini:nonce-1', 600)
  })

  it('resolveSignPath combines mount base and route path', async () => {
    const { resolveSignPath } = await import('../middleware/apiRequestSign.js')
    expect(resolveSignPath({ baseUrl: '/api', path: '/merchants' })).toBe('/api/merchants')
    expect(resolveSignPath({ baseUrl: '/api', path: '/wx/login' })).toBe('/api/wx/login')
  })

  it('passes through when signing is disabled', async () => {
    const middleware = createApiRequestSignMiddleware({ enabled: false })
    const req = createSignedRequest({})
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.body).toBe(null)
  })

  it('passes through skipped paths', async () => {
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: true,
      clients: TEST_CLIENTS,
    })
    const req = { method: 'GET', path: '/api/health', headers: {}, requestId: 'rid' }
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('blocks invalid signatures when enforced', async () => {
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: true,
      clients: TEST_CLIENTS,
      redis: { setNxEx: vi.fn() },
    })
    const req = {
      method: 'GET',
      path: '/api/merchants',
      query: {},
      headers: {},
      requestId: 'rid',
    }
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('MISSING_SIGNATURE')
  })

  it('allows invalid signatures in shadow mode', async () => {
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: false,
      clients: TEST_CLIENTS,
      redis: { setNxEx: vi.fn() },
    })
    const req = {
      method: 'GET',
      path: '/api/merchants',
      query: {},
      headers: {},
      requestId: 'rid',
    }
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.body).toBe(null)
  })

  it('accepts valid signatures and attaches apiSign context', async () => {
    const redis = { setNxEx: vi.fn().mockResolvedValue(true) }
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: true,
      clients: TEST_CLIENTS,
      redis,
      clockSkewSec: 300,
    })
    const req = createSignedRequest({ method: 'POST', path: '/api/cart', body: { right_id: 1 } })
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.apiSign?.apiKey).toBe('wx-mini')
    expect(req.apiSign?.nonce).toBeTruthy()
  })

  it('blocks replayed nonces when enforced', async () => {
    const redis = { setNxEx: vi.fn().mockResolvedValue(false) }
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: true,
      clients: TEST_CLIENTS,
      redis,
      clockSkewSec: 300,
    })
    const req = createSignedRequest({ path: '/api/banners' })
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(401)
    expect(res.body.code).toBe('REPLAY_DETECTED')
  })

  it('degrades when redis is unavailable and strict mode is off', async () => {
    const redis = {
      setNxEx: vi.fn().mockRejectedValue(new Error('redis down')),
    }
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: true,
      strictRedis: false,
      clients: TEST_CLIENTS,
      redis,
      clockSkewSec: 300,
    })
    const req = createSignedRequest({ path: '/api/banners' })
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.apiSign?.nonceSkipped).toBe(true)
  })

  it('returns 503 when redis is unavailable in strict mode', async () => {
    const redis = {
      setNxEx: vi.fn().mockRejectedValue(new Error('redis down')),
    }
    const middleware = createApiRequestSignMiddleware({
      enabled: true,
      enforced: true,
      strictRedis: true,
      clients: TEST_CLIENTS,
      redis,
      clockSkewSec: 300,
    })
    const req = createSignedRequest({ path: '/api/banners' })
    const res = createMockRes()
    const next = vi.fn()

    await middleware(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(503)
    expect(res.body.code).toBe('SIGN_SERVICE_UNAVAILABLE')
  })
})
