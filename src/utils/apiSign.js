/**
 * 浏览器端 API 请求签名（与 utils/apiRequestSign.js 算法一致）
 */

const API_SIGN_HEADER_KEY = 'x-api-key'
const API_SIGN_HEADER_TIMESTAMP = 'x-api-timestamp'
const API_SIGN_HEADER_NONCE = 'x-api-nonce'
const API_SIGN_HEADER_SIGNATURE = 'x-api-signature'

const CLIENT_SIGN_SKIP_PREFIXES = [
  '/api/health',
  '/api/wx/pay/notify',
  '/api/wx/pay/refund/notify',
  '/api/wx/referral/withdraw/notify',
  '/api/wx/oa/callback',
  '/api/upload',
  '/uploads/',
]

function encodeQueryComponent(value) {
  return encodeURIComponent(String(value))
}

function buildCanonicalQuery(query) {
  if (!query || typeof query !== 'object') return ''

  const pairs = []
  const keys = Object.keys(query).sort()

  for (const key of keys) {
    const value = query[key]
    if (value === undefined || value === null) continue

    if (Array.isArray(value)) {
      const sortedValues = [...value].map((v) => String(v)).sort()
      for (const item of sortedValues) {
        pairs.push(`${encodeQueryComponent(key)}=${encodeQueryComponent(item)}`)
      }
      continue
    }

    pairs.push(`${encodeQueryComponent(key)}=${encodeQueryComponent(value)}`)
  }

  return pairs.join('&')
}

async function sha256Hex(bytes) {
  const buffer = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(String(bytes))
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function createApiNonce() {
  return crypto.randomUUID()
}

function createApiTimestamp() {
  return Math.floor(Date.now() / 1000)
}

function shouldSkipClientApiSign(path) {
  const normalizedPath = String(path || '').split('?')[0] || '/'
  return CLIENT_SIGN_SKIP_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix)
  )
}

function resolveApiSignConfig() {
  const apiKey = String(import.meta.env.VITE_API_SIGN_KEY || 'admin-web').trim()
  const secret = String(import.meta.env.VITE_API_SIGN_SECRET || '').trim()
  return { apiKey, secret, enabled: secret.length > 0 }
}

async function buildCanonicalStringAsync({ method, path, query, body, timestamp, nonce, apiKey }) {
  const upperMethod = String(method || '').toUpperCase()
  const normalizedPath = String(path || '').split('?')[0] || '/'
  const canonicalQuery = buildCanonicalQuery(query)
  const bodyHash = await sha256Hex(body == null || body === '' ? '' : body)

  return [
    upperMethod,
    normalizedPath,
    canonicalQuery,
    bodyHash,
    String(timestamp),
    String(nonce),
    String(apiKey),
  ].join('\n')
}

function resolveAxiosSignPath(config) {
  const url = String(config?.url || '').split('?')[0]
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return new URL(url).pathname
  }

  const baseURL = String(config?.baseURL || '').replace(/\/+$/, '')
  const rel = url.replace(/^\/+/, '')
  if (!baseURL) {
    return `/${rel}`
  }

  if (baseURL.startsWith('http://') || baseURL.startsWith('https://')) {
    const pathname = new URL(baseURL).pathname.replace(/\/+$/, '')
    return `${pathname}/${rel}`.replace(/\/+/g, '/')
  }

  return `${baseURL}/${rel}`.replace(/\/+/g, '/')
}

function parseQueryString(search) {
  const params = {}
  const raw = String(search || '').replace(/^\?/, '')
  if (!raw) return params

  for (const part of raw.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const key = decodeURIComponent(eq === -1 ? part : part.slice(0, eq))
    const value = decodeURIComponent(eq === -1 ? '' : part.slice(eq + 1))
    if (params[key] === undefined) params[key] = value
    else if (Array.isArray(params[key])) params[key].push(value)
    else params[key] = [params[key], value]
  }

  return params
}

function resolveAxiosSignQuery(config) {
  const url = String(config?.url || '')
  const qIdx = url.indexOf('?')
  const fromUrl = qIdx === -1 ? {} : parseQueryString(url.slice(qIdx))
  const fromParams = config?.params && typeof config.params === 'object' ? config.params : {}
  return { ...fromUrl, ...fromParams }
}

function resolveAxiosSignBody(config) {
  const method = String(config?.method || 'GET').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return ''

  const data = config?.data
  if (data == null) return ''
  if (typeof data === 'string') return data
  if (typeof FormData !== 'undefined' && data instanceof FormData) return ''
  if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) return ''
  return JSON.stringify(data)
}

async function signApiRequestHeaders({
  method,
  path,
  query,
  body,
  apiKey,
  secret,
  timestamp,
  nonce,
}) {
  const resolvedTimestamp = timestamp ?? createApiTimestamp()
  const resolvedNonce = nonce ?? createApiNonce()
  const canonicalString = await buildCanonicalStringAsync({
    method,
    path,
    query,
    body,
    timestamp: resolvedTimestamp,
    nonce: resolvedNonce,
    apiKey,
  })
  const signature = await hmacSha256Hex(secret, canonicalString)

  return {
    [API_SIGN_HEADER_KEY]: apiKey,
    [API_SIGN_HEADER_TIMESTAMP]: String(resolvedTimestamp),
    [API_SIGN_HEADER_NONCE]: resolvedNonce,
    [API_SIGN_HEADER_SIGNATURE]: signature,
  }
}

function applySignHeadersToConfig(config, signHeaders) {
  if (!config.headers) {
    config.headers = { ...signHeaders }
    return
  }

  if (typeof config.headers.set === 'function') {
    for (const [key, value] of Object.entries(signHeaders)) {
      config.headers.set(key, value)
    }
    return
  }

  config.headers = {
    ...config.headers,
    ...signHeaders,
  }
}

async function applyApiSignToFetchInit(url, init = {}) {
  const { apiKey, secret, enabled } = resolveApiSignConfig()
  const nextInit = {
    ...init,
    headers: init.headers ? { ...init.headers } : {},
  }
  if (!enabled) return nextInit

  let parsedUrl
  try {
    parsedUrl = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost')
  } catch {
    return nextInit
  }

  const path = parsedUrl.pathname
  if (shouldSkipClientApiSign(path)) return nextInit

  const method = String(init.method || 'GET').toUpperCase()
  const body =
    method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || init.body == null
      ? ''
      : typeof init.body === 'string'
        ? init.body
        : ''

  const signHeaders = await signApiRequestHeaders({
    method,
    path,
    query: parseQueryString(parsedUrl.search),
    body,
    apiKey,
    secret,
  })

  nextInit.headers = {
    ...nextInit.headers,
    ...signHeaders,
  }
  return nextInit
}

async function applyApiSignToAxiosConfig(config) {
  const { apiKey, secret, enabled } = resolveApiSignConfig()
  if (!enabled) {
    if (import.meta.env.DEV) {
      console.warn(
        '[api-sign] VITE_API_SIGN_SECRET 未配置，管理端请求不会带签名头；请在 .env 设置后与 API_SIGN_SECRET_ADMIN_WEB 相同并重启 dev / 重新 build'
      )
    }
    return config
  }

  const path = resolveAxiosSignPath(config)
  if (shouldSkipClientApiSign(path)) return config

  const signHeaders = await signApiRequestHeaders({
    method: config.method,
    path,
    query: resolveAxiosSignQuery(config),
    body: resolveAxiosSignBody(config),
    apiKey,
    secret,
  })

  applySignHeadersToConfig(config, signHeaders)

  return config
}

export {
  API_SIGN_HEADER_KEY,
  API_SIGN_HEADER_TIMESTAMP,
  API_SIGN_HEADER_NONCE,
  API_SIGN_HEADER_SIGNATURE,
  buildCanonicalQuery,
  shouldSkipClientApiSign,
  resolveApiSignConfig,
  resolveAxiosSignPath,
  resolveAxiosSignQuery,
  resolveAxiosSignBody,
  signApiRequestHeaders,
  applySignHeadersToConfig,
  applyApiSignToFetchInit,
  applyApiSignToAxiosConfig,
  buildCanonicalStringAsync,
}
