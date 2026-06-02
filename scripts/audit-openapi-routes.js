/**
 * Audit: compare Express routes vs openapi-esa.min.json paths
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')

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
  ['get', '/api/health'],
  ['get', '/api/health/live'],
  ['post', '/api/upload'],
  ['post', '/api/auth/register'],
  ['post', '/api/auth/login'],
  ['get', '/api/auth/me'],
  ['post', '/api/auth/logout'],
  ['get', '/api/digital-identity/purchases/:user_id'],
]

function joinPath(prefix, routePath) {
  if (routePath === '/') return prefix
  const p = routePath.startsWith('/') ? routePath : `/${routePath}`
  return `${prefix}${p}`.replace(/\/+/g, '/')
}

function toOasPath(expressPath) {
  return expressPath.replace(/:([A-Za-z_]+)/g, '{$1}')
}

function collectFromCode() {
  const list = INDEX_ROUTES.map(([method, p]) => ({ method, path: p, source: 'index.js' }))
  const routesDir = path.join(ROOT, 'routes')
  const patterns = [
    /router\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g,
    /router\.(get|post|put|delete|patch)\(\s*\n\s*['"]([^'"]+)['"]/g,
  ]

  for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith('.js')) continue
    const prefix = ROUTE_PREFIX[file]
    if (!prefix) {
      console.warn('WARN: no prefix for', file)
      continue
    }
    const content = fs.readFileSync(path.join(routesDir, file), 'utf8')
    for (const re of patterns) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(content))) {
        list.push({
          method: m[1].toLowerCase(),
          path: joinPath(prefix, m[2]),
          source: `routes/${file}`,
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

function collectFromOpenapi() {
  const spec = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/openapi-esa.min.json'), 'utf8'))
  const list = []
  for (const [oasPath, item] of Object.entries(spec.paths || {})) {
    for (const method of ['get', 'post', 'put', 'delete', 'patch']) {
      if (item[method]) {
        list.push({
          method,
          path: oasPath.replace(/\{([a-zA-Z_]+)\}/g, ':$1'),
          oasPath,
        })
      }
    }
  }
  return list
}

function normKey(r) {
  return `${r.method} ${toOasPath(r.path)}`
}

const code = collectFromCode()
const oas = collectFromOpenapi()

const codeKeys = new Set(code.map(normKey))
const oasKeys = new Set(oas.map((r) => `${r.method} ${r.oasPath}`))

const missingInOas = code.filter((r) => !oasKeys.has(normKey(r)))
const extraInOas = oas.filter((r) => !codeKeys.has(`${r.method} ${r.oasPath}`))

console.log('=== Route audit ===')
console.log('Code routes:', code.length)
console.log('OpenAPI operations:', oas.length)
console.log('OpenAPI paths:', Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/openapi-esa.min.json'))).paths).length)
console.log('')

if (missingInOas.length) {
  console.log('MISSING in OpenAPI (' + missingInOas.length + '):')
  missingInOas.sort((a, b) => a.path.localeCompare(b.path)).forEach((r) => {
    console.log('  ', r.method.toUpperCase(), r.path, ' <-', r.source)
  })
} else {
  console.log('OK: All code routes are in OpenAPI')
}

console.log('')
if (extraInOas.length) {
  console.log('EXTRA in OpenAPI only (' + extraInOas.length + '):')
  extraInOas.forEach((r) => console.log('  ', r.method.toUpperCase(), r.oasPath))
}

// Also grep app. routes in index.js
const indexContent = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8')
const appRoutes = []
const appRe = /app\.(get|post|put|delete|patch)\(\s*['"]([^'"]+)['"]/g
let m
while ((m = appRe.exec(indexContent))) {
  appRoutes.push({ method: m[1].toLowerCase(), path: m[2], source: 'index.js app.*' })
}
console.log('\n=== app.* in index.js ===')
appRoutes.forEach((r) => {
  const inOas = oasKeys.has(`${r.method} ${toOasPath(r.path)}`)
  console.log(inOas ? 'OK' : 'MISSING', r.method.toUpperCase(), r.path)
})

// app.use mounts (informational)
console.log('\n=== app.use mounts (prefix only) ===')
const useRe = /app\.use\(\s*['"]([^'"]+)['"]/g
while ((m = useRe.exec(indexContent))) {
  if (m[1].startsWith('/api')) console.log(' ', m[1])
}
