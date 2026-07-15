const crypto = require('crypto')

const API_SIGN_HEADER_KEY = 'x-api-key'
const API_SIGN_HEADER_TIMESTAMP = 'x-api-timestamp'
const API_SIGN_HEADER_NONCE = 'x-api-nonce'
const API_SIGN_HEADER_SIGNATURE = 'x-api-signature'

const DEFAULT_CLOCK_SKEW_SEC = 300
const DEFAULT_NONCE_TTL_SEC = 600

const SIGN_SKIP_PREFIXES = [
  '/api/health',
  '/api/wx/pay/notify',
  '/api/wx/pay/refund/notify',
  '/api/wx/referral/withdraw/notify',
  '/api/upload',
  '/uploads/',
]

function parsePositiveInt(raw, fallback, { min, max } = {}) {
  const n = parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  if (min != null && n < min) return fallback
  if (max != null && n > max) return fallback
  return n
}

function getApiSignClockSkewSec() {
  return parsePositiveInt(process.env.API_SIGN_CLOCK_SKEW_SEC, DEFAULT_CLOCK_SKEW_SEC, {
    min: 30,
    max: 3600,
  })
}

function getApiSignNonceTtlSec() {
  return parsePositiveInt(process.env.API_SIGN_NONCE_TTL_SEC, DEFAULT_NONCE_TTL_SEC, {
    min: 60,
    max: 86400,
  })
}

function isApiSignEnabled() {
  const raw = String(process.env.API_SIGN_ENABLED ?? 'false').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

function isApiSignEnforced() {
  const raw = String(process.env.API_SIGN_ENFORCE ?? 'false').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

function isTruthyEnvValue(raw) {
  const value = String(raw ?? '').trim().toLowerCase()
  return value === 'true' || value === '1'
}

function isApiSignEnforceWrites() {
  return isTruthyEnvValue(process.env.API_SIGN_ENFORCE_WRITES)
}

const API_SIGN_WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * @returns {'off' | 'writes' | 'all'}
 */
function getApiSignEnforceMode() {
  if (isApiSignEnforced()) return 'all'
  if (isApiSignEnforceWrites()) return 'writes'
  return 'off'
}

function isApiSignWriteMethod(method) {
  return API_SIGN_WRITE_METHODS.has(String(method || '').toUpperCase())
}

function shouldEnforceApiSignForMethod(method, enforceMode = getApiSignEnforceMode()) {
  if (enforceMode === 'all') return true
  if (enforceMode === 'writes') return isApiSignWriteMethod(method)
  return false
}

function isApiSignStrictRedis() {
  const raw = String(process.env.API_SIGN_STRICT_REDIS ?? 'false').trim().toLowerCase()
  return raw === 'true' || raw === '1'
}

/**
 * 解析 API_SIGN_CLIENTS
 * 格式：clientId:secret;clientId2:secretA|secretB（推荐用 ; 分隔客户端，避免密钥含逗号）
 * 兼容旧格式逗号分隔：clientId:secret,clientId2:secret
 */
function parseApiSignClients(raw) {
  const map = new Map()
  if (!raw || typeof raw !== 'string') return map

  const delimiter = raw.includes(';') ? ';' : ','
  for (const segment of raw.split(delimiter)) {
    const trimmed = segment.trim()
    if (!trimmed) continue

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx <= 0) continue

    const clientId = trimmed.slice(0, colonIdx).trim()
    const secretsPart = trimmed.slice(colonIdx + 1).trim()
    const secrets = secretsPart
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)

    if (!clientId || secrets.length === 0) continue
    map.set(clientId, secrets)
  }

  return map
}

const API_SIGN_CLIENT_ENV_KEYS = [
  ['admin-web', 'API_SIGN_SECRET_ADMIN_WEB'],
  ['wx-mini', 'API_SIGN_SECRET_WX_MINI'],
]

function mergeClientSecrets(map, clientId, secrets) {
  if (!clientId || !secrets?.length) return
  const existing = map.get(clientId) || []
  const merged = [...existing]
  for (const secret of secrets) {
    if (!merged.includes(secret)) merged.push(secret)
  }
  map.set(clientId, merged)
}

function loadApiSignClientsFromEnv() {
  const map = parseApiSignClients(process.env.API_SIGN_CLIENTS)

  for (const [clientId, envName] of API_SIGN_CLIENT_ENV_KEYS) {
    const raw = process.env[envName]
    if (!raw || !String(raw).trim()) continue
    const secrets = String(raw)
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    mergeClientSecrets(map, clientId, secrets)
  }

  return map
}

function encodeQueryComponent(value) {
  return encodeURIComponent(String(value))
}

/**
 * Query 按 key 字典序；多值 key 按值字典序展开为多个 key=value
 */
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

function normalizeBodyBytes(body) {
  if (body == null) return Buffer.alloc(0)
  if (Buffer.isBuffer(body)) return body
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  return Buffer.from(JSON.stringify(body), 'utf8')
}

function hashRequestBody(body) {
  return crypto.createHash('sha256').update(normalizeBodyBytes(body)).digest('hex')
}

function buildCanonicalString({
  method,
  path,
  query,
  body,
  timestamp,
  nonce,
  apiKey,
}) {
  const upperMethod = String(method || '').toUpperCase()
  const normalizedPath = String(path || '').split('?')[0] || '/'
  const canonicalQuery = buildCanonicalQuery(query)
  const bodyHash = hashRequestBody(body)

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

function computeSignature(secret, canonicalString) {
  // Request signing (HMAC), not password storage.
  // codeql[js/insufficient-password-hash]
  return crypto.createHmac('sha256', secret).update(canonicalString).digest('hex').toLowerCase()
}

function createApiNonce() {
  return crypto.randomUUID()
}

function createApiTimestamp() {
  return Math.floor(Date.now() / 1000)
}

function readHeader(headers, name) {
  if (!headers || typeof headers !== 'object') return null
  const value = headers[name] ?? headers[String(name).toLowerCase()]
  if (value == null) return null
  const text = String(value).trim()
  return text.length > 0 ? text : null
}

function extractSignHeaders(headers) {
  return {
    apiKey: readHeader(headers, API_SIGN_HEADER_KEY),
    timestamp: readHeader(headers, API_SIGN_HEADER_TIMESTAMP),
    nonce: readHeader(headers, API_SIGN_HEADER_NONCE),
    signature: readHeader(headers, API_SIGN_HEADER_SIGNATURE),
  }
}

function signaturesMatch(provided, expected) {
  const a = String(provided || '').toLowerCase()
  const b = String(expected || '').toLowerCase()
  if (!a || !b || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function signApiRequest({
  method,
  path,
  query,
  body,
  apiKey,
  secret,
  timestamp,
  nonce,
}) {
  if (!apiKey || !secret) {
    throw new Error('signApiRequest 需要 apiKey 与 secret')
  }

  const resolvedTimestamp = timestamp ?? createApiTimestamp()
  const resolvedNonce = nonce ?? createApiNonce()
  const canonicalString = buildCanonicalString({
    method,
    path,
    query,
    body,
    timestamp: resolvedTimestamp,
    nonce: resolvedNonce,
    apiKey,
  })
  const signature = computeSignature(secret, canonicalString)

  return {
    canonicalString,
    signature,
    timestamp: resolvedTimestamp,
    nonce: resolvedNonce,
    headers: {
      [API_SIGN_HEADER_KEY]: apiKey,
      [API_SIGN_HEADER_TIMESTAMP]: String(resolvedTimestamp),
      [API_SIGN_HEADER_NONCE]: resolvedNonce,
      [API_SIGN_HEADER_SIGNATURE]: signature,
    },
  }
}

function verifyTimestamp(timestamp, clockSkewSec = getApiSignClockSkewSec()) {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) {
    return { ok: false, code: 'EXPIRED_TIMESTAMP', error: '时间戳无效' }
  }

  const now = Math.floor(Date.now() / 1000)
  if (Math.abs(now - ts) > clockSkewSec) {
    return { ok: false, code: 'EXPIRED_TIMESTAMP', error: '请求已过期' }
  }

  return { ok: true, timestamp: ts }
}

function verifyApiRequestSignature({
  method,
  path,
  query,
  body,
  headers,
  clients,
  clockSkewSec,
}) {
  const signHeaders = extractSignHeaders(headers)
  const { apiKey, timestamp, nonce, signature } = signHeaders

  if (!apiKey || !timestamp || !nonce || !signature) {
    return { ok: false, code: 'MISSING_SIGNATURE', error: '缺少请求签名头' }
  }

  const clientMap = clients instanceof Map ? clients : parseApiSignClients(clients)
  const secrets = clientMap.get(apiKey)
  if (!secrets || secrets.length === 0) {
    return { ok: false, code: 'UNKNOWN_API_KEY', error: '未知客户端' }
  }

  const tsResult = verifyTimestamp(timestamp, clockSkewSec)
  if (!tsResult.ok) return tsResult

  const canonicalString = buildCanonicalString({
    method,
    path,
    query,
    body,
    timestamp,
    nonce,
    apiKey,
  })

  const isValid = secrets.some((secret) =>
    signaturesMatch(signature, computeSignature(secret, canonicalString))
  )

  if (!isValid) {
    return { ok: false, code: 'INVALID_SIGNATURE', error: '请求签名无效' }
  }

  return {
    ok: true,
    apiKey,
    timestamp: tsResult.timestamp,
    nonce,
    canonicalString,
  }
}

function shouldSkipApiSign({ method, path }) {
  if (String(method || '').toUpperCase() === 'OPTIONS') return true

  const normalizedPath = String(path || '').split('?')[0] || '/'
  return SIGN_SKIP_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix)
  )
}

function buildApiSignNonceRedisKey(apiKey, nonce) {
  return `api_sign:nonce:${apiKey}:${nonce}`
}

/**
 * 验签时优先使用原始请求体字节，与客户端发送内容保持一致
 */
function resolveRequestBodyForSign(req) {
  const method = String(req?.method || '').toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return ''

  if (Buffer.isBuffer(req?.rawBody) && req.rawBody.length > 0) return req.rawBody
  if (typeof req?.rawBody === 'string' && req.rawBody.length > 0) return req.rawBody

  return req?.body
}

module.exports = {
  API_SIGN_HEADER_KEY,
  API_SIGN_HEADER_TIMESTAMP,
  API_SIGN_HEADER_NONCE,
  API_SIGN_HEADER_SIGNATURE,
  SIGN_SKIP_PREFIXES,
  DEFAULT_CLOCK_SKEW_SEC,
  DEFAULT_NONCE_TTL_SEC,
  parseApiSignClients,
  loadApiSignClientsFromEnv,
  buildCanonicalQuery,
  normalizeBodyBytes,
  hashRequestBody,
  buildCanonicalString,
  computeSignature,
  createApiNonce,
  createApiTimestamp,
  extractSignHeaders,
  signApiRequest,
  verifyTimestamp,
  verifyApiRequestSignature,
  shouldSkipApiSign,
  buildApiSignNonceRedisKey,
  resolveRequestBodyForSign,
  getApiSignClockSkewSec,
  getApiSignNonceTtlSec,
  isApiSignEnabled,
  isApiSignEnforced,
  isApiSignEnforceWrites,
  getApiSignEnforceMode,
  isApiSignWriteMethod,
  shouldEnforceApiSignForMethod,
  API_SIGN_WRITE_METHODS,
  isApiSignStrictRedis,
}
