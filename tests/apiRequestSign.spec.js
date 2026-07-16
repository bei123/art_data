import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  parseApiSignClients,
  buildCanonicalQuery,
  hashRequestBody,
  buildCanonicalString,
  signApiRequest,
  verifyApiRequestSignature,
  verifyTimestamp,
  shouldSkipApiSign,
  buildApiSignNonceRedisKey,
} from '../utils/apiRequestSign.js'

const TEST_CLIENTS = parseApiSignClients('admin-web:test-admin-secret,wx-mini:test-wx-secret|test-wx-secret-rotated')

describe('apiRequestSign', () => {
  const envBackup = { ...process.env }

  beforeEach(() => {
    process.env.API_SIGN_CLOCK_SKEW_SEC = '300'
  })

  afterEach(() => {
    process.env = { ...envBackup }
  })

  it('parseApiSignClients supports rotation secrets', () => {
    const clients = parseApiSignClients('admin-web:abc,wx-mini:def|ghi')
    expect(clients.get('admin-web')).toEqual(['abc'])
    expect(clients.get('wx-mini')).toEqual(['def', 'ghi'])
  })

  it('buildCanonicalQuery sorts keys and encodes values', () => {
    expect(buildCanonicalQuery({ b: '2', a: '1' })).toBe('a=1&b=2')
    expect(buildCanonicalQuery({ tags: ['b', 'a'] })).toBe('tags=a&tags=b')
    expect(buildCanonicalQuery({ q: 'a b' })).toBe('q=a%20b')
    expect(buildCanonicalQuery(null)).toBe('')
  })

  it('hashRequestBody handles empty, string and object bodies', () => {
    const emptyHash = hashRequestBody()
    expect(emptyHash).toHaveLength(64)
    expect(hashRequestBody('')).toBe(emptyHash)
    expect(hashRequestBody({ a: 1 })).toBe(hashRequestBody({ a: 1 }))
    expect(hashRequestBody('{"a": 1}')).not.toBe(hashRequestBody({ a: 1 }))
  })

  it('buildCanonicalString follows the documented format', () => {
    const canonical = buildCanonicalString({
      method: 'post',
      path: '/api/cart',
      query: {},
      body: { right_id: 1, quantity: 2 },
      timestamp: 1720185600,
      nonce: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
      apiKey: 'wx-mini',
    })

    expect(canonical).toBe(
      [
        'POST',
        '/api/cart',
        '',
        hashRequestBody({ right_id: 1, quantity: 2 }),
        '1720185600',
        '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        'wx-mini',
      ].join('\n')
    )
  })

  it('signApiRequest and verifyApiRequestSignature accept matching requests', () => {
    const body = { right_id: 1, quantity: 2 }
    const signed = signApiRequest({
      method: 'POST',
      path: '/api/cart',
      query: { source: 'mini' },
      body,
      apiKey: 'wx-mini',
      secret: 'test-wx-secret',
      timestamp: 1720185600,
      nonce: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    })

    const verified = verifyApiRequestSignature({
      method: 'POST',
      path: '/api/cart',
      query: { source: 'mini' },
      body,
      headers: signed.headers,
      clients: TEST_CLIENTS,
      clockSkewSec: 999999999,
    })

    expect(verified.ok).toBe(true)
    expect(verified.apiKey).toBe('wx-mini')
    expect(verified.nonce).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7')
  })

  it('verifyApiRequestSignature rejects tampered body', () => {
    const signed = signApiRequest({
      method: 'POST',
      path: '/api/cart',
      body: { right_id: 1 },
      apiKey: 'wx-mini',
      secret: 'test-wx-secret',
      timestamp: 1720185600,
      nonce: 'nonce-1',
    })

    const verified = verifyApiRequestSignature({
      method: 'POST',
      path: '/api/cart',
      body: { right_id: 2 },
      headers: signed.headers,
      clients: TEST_CLIENTS,
      clockSkewSec: 999999999,
    })

    expect(verified).toEqual({
      ok: false,
      code: 'INVALID_SIGNATURE',
      error: '请求签名无效',
    })
  })

  it('verifyApiRequestSignature rejects tampered path and method', () => {
    const signed = signApiRequest({
      method: 'GET',
      path: '/api/merchants',
      apiKey: 'admin-web',
      secret: 'test-admin-secret',
      timestamp: 1720185600,
      nonce: 'nonce-2',
    })

    expect(
      verifyApiRequestSignature({
        method: 'DELETE',
        path: '/api/merchants',
        headers: signed.headers,
        clients: TEST_CLIENTS,
        clockSkewSec: 999999999,
      }).code
    ).toBe('INVALID_SIGNATURE')

    expect(
      verifyApiRequestSignature({
        method: 'GET',
        path: '/api/merchants/1',
        headers: signed.headers,
        clients: TEST_CLIENTS,
        clockSkewSec: 999999999,
      }).code
    ).toBe('INVALID_SIGNATURE')
  })

  it('verifyApiRequestSignature accepts rotated secrets', () => {
    const signed = signApiRequest({
      method: 'GET',
      path: '/api/banners',
      apiKey: 'wx-mini',
      secret: 'test-wx-secret-rotated',
      timestamp: 1720185600,
      nonce: 'nonce-3',
    })

    const verified = verifyApiRequestSignature({
      method: 'GET',
      path: '/api/banners',
      headers: signed.headers,
      clients: TEST_CLIENTS,
      clockSkewSec: 999999999,
    })

    expect(verified.ok).toBe(true)
  })

  it('verifyTimestamp rejects invalid and expired timestamps', () => {
    expect(verifyTimestamp('invalid', 300)).toEqual({
      ok: false,
      code: 'EXPIRED_TIMESTAMP',
      error: '时间戳无效',
    })

    const oldTs = Math.floor(Date.now() / 1000) - 400
    expect(verifyTimestamp(oldTs, 300)).toEqual({
      ok: false,
      code: 'EXPIRED_TIMESTAMP',
      error: '请求已过期',
    })
  })

  it('verifyApiRequestSignature reports missing headers and unknown api key', () => {
    expect(
      verifyApiRequestSignature({
        method: 'GET',
        path: '/api/banners',
        headers: {},
        clients: TEST_CLIENTS,
      })
    ).toEqual({
      ok: false,
      code: 'MISSING_SIGNATURE',
      error: '缺少请求签名头',
    })

    const signed = signApiRequest({
      method: 'GET',
      path: '/api/banners',
      apiKey: 'unknown-client',
      secret: 'secret',
      timestamp: 1720185600,
      nonce: 'nonce-4',
    })

    expect(
      verifyApiRequestSignature({
        method: 'GET',
        path: '/api/banners',
        headers: signed.headers,
        clients: TEST_CLIENTS,
        clockSkewSec: 999999999,
      })
    ).toEqual({
      ok: false,
      code: 'UNKNOWN_API_KEY',
      error: '未知客户端',
    })
  })

  it('shouldSkipApiSign covers health, notify and OPTIONS', () => {
    expect(shouldSkipApiSign({ method: 'OPTIONS', path: '/api/cart' })).toBe(true)
    expect(shouldSkipApiSign({ method: 'GET', path: '/api/health' })).toBe(true)
    expect(shouldSkipApiSign({ method: 'GET', path: '/api/health/live' })).toBe(true)
    expect(shouldSkipApiSign({ method: 'POST', path: '/api/wx/pay/notify' })).toBe(true)
    expect(shouldSkipApiSign({ method: 'GET', path: '/uploads/demo.jpg' })).toBe(true)
    expect(shouldSkipApiSign({ method: 'POST', path: '/api/upload' })).toBe(true)
    expect(shouldSkipApiSign({ method: 'GET', path: '/api/merchants' })).toBe(false)
  })

  it('parseApiSignClients supports semicolon-separated clients', () => {
    const clients = parseApiSignClients('admin-web:abc;wx-mini:def|ghi')
    expect(clients.get('admin-web')).toEqual(['abc'])
    expect(clients.get('wx-mini')).toEqual(['def', 'ghi'])
  })

  it('loadApiSignClientsFromEnv merges API_SIGN_SECRET_* variables', async () => {
    vi.stubEnv('API_SIGN_CLIENTS', '')
    vi.stubEnv('API_SIGN_SECRET_ADMIN_WEB', 'admin-secret')
    vi.stubEnv('API_SIGN_SECRET_WX_MINI', 'wx-secret')
    vi.resetModules()
    const { loadApiSignClientsFromEnv } = await import('../utils/apiRequestSign.js')
    const clients = loadApiSignClientsFromEnv()
    expect(clients.get('admin-web')).toEqual(['admin-secret'])
    expect(clients.get('wx-mini')).toEqual(['wx-secret'])
  })

  it('shouldEnforceApiSignForMethod supports off, writes and all modes', async () => {
    vi.stubEnv('API_SIGN_ENFORCE', 'false')
    vi.stubEnv('API_SIGN_ENFORCE_WRITES', 'false')
    vi.resetModules()
    const {
      getApiSignEnforceMode,
      shouldEnforceApiSignForMethod,
    } = await import('../utils/apiRequestSign.js')

    expect(getApiSignEnforceMode()).toBe('off')
    expect(shouldEnforceApiSignForMethod('GET', 'off')).toBe(false)
    expect(shouldEnforceApiSignForMethod('POST', 'off')).toBe(false)

    expect(shouldEnforceApiSignForMethod('GET', 'writes')).toBe(false)
    expect(shouldEnforceApiSignForMethod('POST', 'writes')).toBe(true)
    expect(shouldEnforceApiSignForMethod('DELETE', 'writes')).toBe(true)

    expect(shouldEnforceApiSignForMethod('GET', 'all')).toBe(true)
    expect(shouldEnforceApiSignForMethod('POST', 'all')).toBe(true)
  })

  it('getApiSignEnforceMode resolves writes and all from env', async () => {
    vi.stubEnv('API_SIGN_ENFORCE', 'false')
    vi.stubEnv('API_SIGN_ENFORCE_WRITES', 'true')
    vi.resetModules()
    const { getApiSignEnforceMode } = await import('../utils/apiRequestSign.js')
    expect(getApiSignEnforceMode()).toBe('writes')

    vi.stubEnv('API_SIGN_ENFORCE', 'true')
    vi.resetModules()
    const { getApiSignEnforceMode: getModeAll } = await import('../utils/apiRequestSign.js')
    expect(getModeAll()).toBe('all')
  })

  it('verifies GET requests with usn query on server', () => {
    const clients = new Map([['wx-mini', ['test-wx-secret']]])
    const signed = signApiRequest({
      method: 'GET',
      path: '/api/digital-artworks/1963494180583952430',
      query: {
        usn: '41f8d683165712af3aec33e1c840898fe4bdec9f637eaf6642d0774e2e81fb3b',
      },
      apiKey: 'wx-mini',
      secret: 'test-wx-secret',
      timestamp: 1720185600,
      nonce: 'nonce-usn-test',
    })

    const verified = verifyApiRequestSignature({
      method: 'GET',
      path: '/api/digital-artworks/1963494180583952430',
      query: {
        usn: '41f8d683165712af3aec33e1c840898fe4bdec9f637eaf6642d0774e2e81fb3b',
      },
      body: '',
      headers: signed.headers,
      clients,
      clockSkewSec: 999999999,
    })

    expect(verified.ok).toBe(true)
  })

  it('parseApiSignClients preserves secrets with special characters', () => {
    const clients = parseApiSignClients(
      'admin-web:PIUL^u+Rv1j6ho)(5miH,wx-mini:8NsZDr%PbS%(TAs1FV'
    )
    expect(clients.get('admin-web')).toEqual(['PIUL^u+Rv1j6ho)(5miH'])
    expect(clients.get('wx-mini')).toEqual(['8NsZDr%PbS%(TAs1FV'])
  })

  it('buildApiSignNonceRedisKey namespaces by api key and nonce', () => {
    expect(buildApiSignNonceRedisKey('wx-mini', 'nonce-1')).toBe('api_sign:nonce:wx-mini:nonce-1')
  })
})
