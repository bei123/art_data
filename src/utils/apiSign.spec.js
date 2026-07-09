import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'
import { signApiRequest } from '../../utils/apiRequestSign.js'
import {
  buildCanonicalQuery,
  resolveAxiosSignPath,
  resolveAxiosSignQuery,
  resolveAxiosSignBody,
  signApiRequestHeaders,
  applyApiSignToAxiosConfig,
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

  it('resolveAxiosSignQuery merges query string from URL and params', () => {
    expect(
      resolveAxiosSignQuery({
        url: '/digital-artworks/123?usn=abc',
        params: { page: '1' },
      })
    ).toEqual({ usn: 'abc', page: '1' })

    expect(
      resolveAxiosSignQuery({
        url: '/digital-artworks/123?usn=abc',
        params: { usn: 'override' },
      })
    ).toEqual({ usn: 'override' })
  })

  it('signApiRequestHeaders matches backend for GET with query', async () => {
    const payload = {
      method: 'GET',
      path: '/api/digital-artworks/1963494180583952430',
      query: {
        usn: '41f8d683165712af3aec33e1c840898fe4bdec9f637eaf6642d0774e2e81fb3b',
      },
      body: '',
      apiKey: 'wx-mini',
      secret: 'test-wx-secret',
      timestamp: 1720185600,
      nonce: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    }

    const serverSigned = signApiRequest(payload)
    const clientSigned = await signApiRequestHeaders(payload)

    expect(clientSigned).toEqual(serverSigned.headers)
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

  it('applyApiSignToAxiosConfig sets x-api-key on axios AxiosHeaders', async () => {
    const instance = axios.create({
      baseURL: 'http://localhost:2000/api',
      headers: { 'Content-Type': 'application/json' },
    })
    const config = await instance.getUri({
      url: '/merchants',
      method: 'GET',
      headers: instance.defaults.headers,
    })
    const requestConfig = {
      baseURL: 'http://localhost:2000/api',
      url: '/merchants',
      method: 'GET',
      headers: axios.AxiosHeaders.from(instance.defaults.headers),
    }

    await applyApiSignToAxiosConfig(requestConfig)

    expect(requestConfig.headers.get('x-api-key')).toBe('admin-web')
    expect(requestConfig.headers.get('x-api-signature')).toBeTruthy()
    expect(requestConfig.headers.get('x-api-nonce')).toBeTruthy()
    expect(requestConfig.headers.get('x-api-timestamp')).toBeTruthy()
  })
})
