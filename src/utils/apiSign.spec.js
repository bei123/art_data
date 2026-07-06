import { describe, it, expect, vi, beforeEach } from 'vitest'
import { signApiRequest } from '../../utils/apiRequestSign.js'
import {
  buildCanonicalQuery,
  resolveAxiosSignPath,
  resolveAxiosSignBody,
  signApiRequestHeaders,
} from './apiSign.js'

describe('admin apiSign client', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_SIGN_KEY', 'admin-web')
    vi.stubEnv('VITE_API_SIGN_SECRET', 'test-admin-secret')
  })

  it('buildCanonicalQuery matches backend ordering', () => {
    expect(buildCanonicalQuery({ b: '2', a: '1' })).toBe('a=1&b=2')
  })

  it('resolveAxiosSignPath builds /api paths from axios config', () => {
    expect(
      resolveAxiosSignPath({
        baseURL: 'http://localhost:2000/api',
        url: '/merchants',
      })
    ).toBe('/api/merchants')

    expect(
      resolveAxiosSignPath({
        baseURL: '/api',
        url: 'banners',
      })
    ).toBe('/api/banners')
  })

  it('signApiRequestHeaders matches backend signApiRequest', async () => {
    const payload = {
      method: 'POST',
      path: '/api/cart',
      query: { source: 'admin' },
      body: '{"right_id":1}',
      apiKey: 'admin-web',
      secret: 'test-admin-secret',
      timestamp: 1720185600,
      nonce: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    }

    const serverSigned = signApiRequest(payload)
    const clientSigned = await signApiRequestHeaders(payload)

    expect(clientSigned).toEqual(serverSigned.headers)
  })

  it('resolveAxiosSignBody stringifies JSON request bodies', () => {
    expect(
      resolveAxiosSignBody({
        method: 'POST',
        data: { a: 1 },
      })
    ).toBe('{"a":1}')
    expect(resolveAxiosSignBody({ method: 'GET', data: { a: 1 } })).toBe('')
  })
})
