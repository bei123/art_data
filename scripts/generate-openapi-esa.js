/**
 * Generate ESA-compliant OpenAPI 3.0 spec from route files.
 * Run: node scripts/generate-openapi-esa.js
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const PUBLIC_API = 'https://api.wx.2000gallery.art'

const ROUTE_PREFIX = {
  'wx.js': '/api/wx',
  'pay.js': '/api/wx/pay',
  'favorites.js': '/api/favorites',
  'merchants.js': '/api/merchants',
  'cart.js': '/api/cart',
  'banners.js': '/api/banners',
  'artists.js': '/api/artists',
  'artworks.js': '/api/original-artworks',
  'digital-artworks.js': '/api/digital-artworks',
  'physical-categories.js': '/api/physical-categories',
  'rights.js': '/api/rights',
  'upload.js': '/api/upload',
  'user.js': '/api/user',
  'search.js': '/api/search',
  'external-api.js': '/api/external',
  'issuance.js': '/api/issuance',
  'asset-transfer.js': '/api/asset-transfer',
  'asset-verify.js': '/api/asset-verify',
  'transaction.js': '/api/transaction',
  'institutions.js': '/api/institutions',
  'home-titles.js': '/api/home-titles',
  'exhibitions.js': '/api/exhibitions',
  'webview.js': '/api/webview',
}

const INDEX_ROUTES = [
  { method: 'get', path: '/api/health', op: 'getHealth', summary: '健康检查' },
  { method: 'get', path: '/api/health/live', op: 'getHealthLive', summary: '存活探针' },
  { method: 'post', path: '/api/upload', op: 'postUpload', summary: '上传文件到OSS', auth: true },
  { method: 'post', path: '/api/auth/register', op: 'postAuthRegister', summary: '后台用户注册', body: 'AuthRegister' },
  { method: 'post', path: '/api/auth/login', op: 'postAuthLogin', summary: '后台用户登录', body: 'AuthLogin' },
  { method: 'get', path: '/api/auth/me', op: 'getAuthMe', summary: '当前登录用户', auth: true },
  { method: 'post', path: '/api/auth/logout', op: 'postAuthLogout', summary: '登出', auth: true },
  { method: 'get', path: '/api/digital-identity/purchases/:user_id', op: 'getDigitalIdentityPurchases', summary: 'Digital identity purchases', auth: true },
]

/** ESA 控制台解析对中文、enum、array 等支持有限，统一用英文 tag */
const MODULE_TAGS = {
  '/api/health': 'system',
  '/api/auth': 'auth',
  '/api/upload': 'upload',
  '/api/wx': 'wechat',
  '/api/wx/pay': 'wechat-pay',
  '/api/favorites': 'favorites',
  '/api/cart': 'cart',
  '/api/banners': 'banners',
  '/api/artists': 'artists',
  '/api/original-artworks': 'artworks',
  '/api/digital-artworks': 'digital-artworks',
  '/api/physical-categories': 'physical-categories',
  '/api/rights': 'rights',
  '/api/merchants': 'merchants',
  '/api/user': 'user',
  '/api/search': 'search',
  '/api/external': 'external',
  '/api/issuance': 'issuance',
  '/api/asset-transfer': 'asset-transfer',
  '/api/asset-verify': 'asset-verify',
  '/api/transaction': 'transaction',
  '/api/institutions': 'institutions',
  '/api/home-titles': 'home-titles',
  '/api/exhibitions': 'exhibitions',
  '/api/webview': 'webview',
  '/api/digital-identity': 'digital-identity',
}

function getTag(apiPath) {
  const keys = Object.keys(MODULE_TAGS).sort((a, b) => b.length - a.length)
  for (const k of keys) {
    if (apiPath === k || apiPath.startsWith(k + '/')) return MODULE_TAGS[k]
  }
  return 'API'
}

function joinPath(prefix, routePath) {
  if (routePath === '/') return prefix
  const p = routePath.startsWith('/') ? routePath : `/${routePath}`
  return `${prefix}${p}`.replace(/\/+/g, '/')
}

function toOasPath(expressPath) {
  return expressPath.replace(/:([A-Za-z_]+)/g, '{$1}')
}

function safeOperationId(method, fullPath) {
  const clean = fullPath
    .replace(/^\/api\//, '')
    .replace(/[:{}]/g, '_')
    .replace(/\//g, '_')
    .replace(/-/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  const id = `${method}_${clean}`
  return /^[A-Za-z]/.test(id) ? id : `op_${id}`
}

function hasJsonBody(method) {
  return method === 'post' || method === 'put' || method === 'patch'
}

const BODY_REF_RULES = [
  [/auth\/register$/, 'AuthRegister'],
  [/auth\/login$/, 'AuthLogin'],
  [/\/cart$/, 'CartAddItem', 'post'],
  [/\/cart\/\{id\}$/, 'CartUpdateQuantity', 'put'],
  [/\/favorites$/, 'FavoriteAdd', 'post'],
  [/wx\/login$/, 'WxCodeBody', 'post'],
  [/wx\/getPhoneNumber$/, 'WxCodeBody', 'post'],
  [/wx\/pay\/unifiedorder$/, 'PayOrderBody', 'post'],
  [/wx\/pay\/singleorder$/, 'PayOrderBody', 'post'],
]

function defaultBodyRef(fullPath, method) {
  const oas = toOasPath(fullPath)
  for (const rule of BODY_REF_RULES) {
    const [re, schema, m] = rule
    if (oas.match(re) && (!m || m === method)) return schema
  }
  return null
}

function collectRoutes() {
  const list = [...INDEX_ROUTES]
  const routesDir = path.join(ROOT, 'routes')
  const re = /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g
  const reMultiline = /router\.(get|post|put|delete|patch)\(\s*\n\s*['"]([^'"]+)['"]/g

  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue
    const prefix = ROUTE_PREFIX[file]
    if (!prefix) continue
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8')
    const patterns = [re, reMultiline]
    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let m
      while ((m = pattern.exec(content))) {
      const method = m[1].toLowerCase()
      const fullPath = joinPath(prefix, m[2])
        list.push({
          method,
          path: fullPath,
          op: safeOperationId(method, fullPath),
          summary: `${method.toUpperCase()} ${fullPath}`,
          auth: /authenticateToken/.test(content.slice(m.index, m.index + 400)),
        })
      }
    }
  }

  const seen = new Set()
  return list.filter((r) => {
    const key = `${r.method} ${r.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildSpec() {
  const routes = collectRoutes()
  const paths = {}

  for (const r of routes) {
    const oasPath = toOasPath(r.path)
    if (!paths[oasPath]) paths[oasPath] = {}
    const tag = getTag(r.path)
    const op = {
      operationId: r.op || safeOperationId(r.method, r.path),
      summary: `${r.method.toUpperCase()} ${oasPath}`,
      tags: [tag],
      responses: { '200': { description: 'success' } },
    }

    const pathParamRe = /\{([a-zA-Z_]+)\}/g
    let pm
    const params = []
    while ((pm = pathParamRe.exec(oasPath))) {
      const isId = /id/i.test(pm[1])
      params.push({
        name: pm[1],
        in: 'path',
        required: true,
        schema: isId
          ? { type: 'integer', format: 'int32' }
          : { type: 'string' },
      })
    }
    if (params.length) op.parameters = params

    if (oasPath === '/api/search' && r.method === 'get') {
      op.parameters = [
        ...(op.parameters || []),
        { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
      ]
    }

    if (oasPath === '/api/favorites/{itemType}/{itemId}' && r.method === 'delete') {
      const itemIdParam = op.parameters?.find((p) => p.name === 'itemId')
      if (itemIdParam) itemIdParam.schema = { type: 'string' }
    }

    const bodyRef = r.body || defaultBodyRef(r.path, r.method)
    if (hasJsonBody(r.method) && bodyRef) {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${bodyRef}` },
          },
        },
      }
    }

    paths[oasPath][r.method] = op
  }

  return {
    openapi: '3.0.0',
    info: {
      title: 'Art Data API',
      description: 'ESA API schema validation',
      version: '1.0.0',
    },
    servers: [{ url: PUBLIC_API, description: 'production' }],
    components: {
      schemas: {
        AuthRegister: {
          type: 'object',
          required: ['username', 'email', 'password'],
          properties: {
            username: { type: 'string' },
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
        AuthLogin: {
          type: 'object',
          required: ['username', 'password'],
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
        WxCodeBody: {
          type: 'object',
          properties: {
            code: { type: 'string' },
          },
        },
        CartAddItem: {
          type: 'object',
          required: ['type', 'quantity'],
          properties: {
            type: { type: 'string' },
            right_id: { type: 'integer', format: 'int32' },
            digital_artwork_id: { type: 'integer', format: 'int32' },
            artwork_id: { type: 'integer', format: 'int32' },
            quantity: { type: 'integer', format: 'int32' },
            price: { type: 'number', format: 'double' },
          },
        },
        CartUpdateQuantity: {
          type: 'object',
          required: ['quantity'],
          properties: {
            quantity: { type: 'integer', format: 'int32' },
          },
        },
        FavoriteAdd: {
          type: 'object',
          required: ['item_type', 'item_id'],
          properties: {
            item_type: { type: 'string' },
            item_id: { type: 'string' },
          },
        },
        PayOrderBody: {
          type: 'object',
          properties: {
            order_id: { type: 'integer', format: 'int32' },
            description: { type: 'string' },
            total_fee: { type: 'integer', format: 'int32' },
          },
        },
      },
    },
    paths,
  }
}

function buildSmokeSpec() {
  return {
    openapi: '3.0.0',
    info: { title: 'Art Data API Smoke', description: 'ESA upload test', version: '1.0' },
    servers: [{ url: PUBLIC_API, description: 'production' }],
    components: {
      schemas: {
        ParamsObject: {
          type: 'object',
          properties: {
            id: { type: 'integer', format: 'int32' },
            value: { type: 'string' },
          },
          required: ['id', 'value'],
        },
      },
    },
    paths: {
      '/api/health': {
        get: {
          operationId: 'getHealth',
          summary: 'health check',
          parameters: [],
          responses: { '200': { description: 'success' } },
        },
      },
      '/api/auth/login': {
        post: {
          operationId: 'postAuthLogin',
          summary: 'admin login',
          parameters: [],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ParamsObject' },
              },
            },
          },
          responses: { '200': { description: 'success' } },
        },
      },
    },
  }
}

function validateEsaSpec(spec, label) {
  const raw = JSON.stringify(spec)
  const issues = []
  if (Buffer.byteLength(raw, 'utf8') > 59392) issues.push('file exceeds 58KB')
  if (/[\u4e00-\u9fff]/.test(raw)) issues.push('contains Chinese characters')
  if (/"enum"/.test(raw)) issues.push('contains enum (not supported by ESA)')
  if (/"type":"array"/.test(raw) || /"type": "array"/.test(raw)) issues.push('contains array schema')
  const opRe = /"operationId":"([^"]+)"/g
  let m
  while ((m = opRe.exec(raw))) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(m[1])) issues.push(`invalid operationId: ${m[1]}`)
  }
  if (issues.length) {
    console.warn(`[${label}] ESA validation warnings:`, issues.join('; '))
  }
  return issues
}

const spec = buildSpec()
const smoke = buildSmokeSpec()
const outDir = path.join(ROOT, 'docs')
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

const pretty = path.join(outDir, 'openapi-esa.json')
const minified = path.join(outDir, 'openapi-esa.min.json')
const smokePath = path.join(outDir, 'openapi-esa-smoke.json')
const json = JSON.stringify(spec, null, 2)
const min = JSON.stringify(spec)
fs.writeFileSync(pretty, json, 'utf8')
fs.writeFileSync(minified, min, 'utf8')
fs.writeFileSync(smokePath, JSON.stringify(smoke), 'utf8')
validateEsaSpec(spec, 'full')
validateEsaSpec(smoke, 'smoke')

const kb = (n) => (n / 1024).toFixed(2)
const prettyBytes = Buffer.byteLength(json, 'utf8')
const minBytes = Buffer.byteLength(min, 'utf8')
let opCount = 0
for (const p of Object.values(spec.paths)) {
  for (const m of ['get', 'post', 'put', 'delete', 'patch']) {
    if (p[m]) opCount++
  }
}
console.log('operations:', opCount)
console.log('paths:', Object.keys(spec.paths).length)
console.log('pretty:', kb(prettyBytes), 'KB')
console.log('minified:', kb(minBytes), 'KB', minBytes <= 59392 ? '(ESA OK)' : '(OVER 58KB)')
console.log('written:', pretty, minified)
