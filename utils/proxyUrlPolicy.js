const dns = require('dns').promises
const { isIP } = require('net')

const DEFAULT_ALLOWED_HOSTS = [
  'm.wespace.cn',
  'node.wespace.cn',
]

function parseAllowedHosts() {
  const raw = String(process.env.WEBVIEW_PROXY_ALLOWED_HOSTS || '').trim()
  const extra = raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  return [...new Set([...DEFAULT_ALLOWED_HOSTS.map((h) => h.toLowerCase()), ...extra])]
}

function isPrivateOrReservedIp(ip) {
  const kind = isIP(ip)
  if (kind === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 127 || a === 0) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a >= 224) return true
    return false
  }
  if (kind === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1') return true
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('fe80')) return true
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice(7)
      if (isIP(mapped) === 4) return isPrivateOrReservedIp(mapped)
    }
    return false
  }
  return false
}

function isHostnameAllowed(hostname) {
  const host = String(hostname || '').trim().toLowerCase().replace(/\.$/, '')
  if (!host) return false

  // 禁止 IP 字面量，只允许域名白名单
  if (isIP(host)) return false

  const allowed = parseAllowedHosts()
  if (allowed.includes(host)) return true

  return allowed.some((entry) => host === entry || host.endsWith(`.${entry}`))
}

/**
 * @returns {{ ok: true, url: string, hostname: string } | { ok: false, status: number, message: string }}
 */
function validateProxyTargetUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    return { ok: false, status: 400, message: 'targetUrl参数不能为空' }
  }

  let urlObj
  try {
    urlObj = new URL(urlString.trim())
  } catch {
    return { ok: false, status: 400, message: '无效的URL格式' }
  }

  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    return { ok: false, status: 400, message: '只支持http和https协议' }
  }

  if (process.env.NODE_ENV === 'production' && urlObj.protocol !== 'https:') {
    return { ok: false, status: 400, message: '生产环境仅允许https目标地址' }
  }

  if (urlObj.username || urlObj.password) {
    return { ok: false, status: 400, message: 'URL不允许包含用户名或密码' }
  }

  const port = urlObj.port
    ? parseInt(urlObj.port, 10)
    : (urlObj.protocol === 'https:' ? 443 : 80)
  if (![80, 443].includes(port)) {
    return { ok: false, status: 400, message: '不允许使用该端口' }
  }

  if (!isHostnameAllowed(urlObj.hostname)) {
    return { ok: false, status: 403, message: '目标域名不在允许列表中' }
  }

  return { ok: true, url: urlObj.href, hostname: urlObj.hostname }
}

async function assertResolvedHostIsPublic(hostname) {
  try {
    const results = await dns.lookup(hostname, { all: true })
    if (!results.length) {
      return { ok: false, status: 502, message: '无法解析目标域名' }
    }
    for (const { address } of results) {
      if (isPrivateOrReservedIp(address)) {
        return { ok: false, status: 403, message: '目标地址不可访问' }
      }
    }
    return { ok: true }
  } catch {
    return { ok: false, status: 502, message: '无法解析目标域名' }
  }
}

function createProxyRedirectGuard() {
  return (options) => {
    const check = validateProxyTargetUrl(options.href)
    if (!check.ok) {
      const err = new Error(check.message || '重定向目标被拒绝')
      err.code = 'PROXY_REDIRECT_BLOCKED'
      throw err
    }
  }
}

/**
 * Validate proxy target and return a fixed href for outbound requests.
 * @returns {Promise<{ ok: true, requestUrl: string, hostname: string } | { ok: false, status: number, message: string }>}
 */
async function resolveSafeProxyRequestUrl(urlString) {
  const urlCheck = validateProxyTargetUrl(urlString)
  if (!urlCheck.ok) return urlCheck

  const dnsCheck = await assertResolvedHostIsPublic(urlCheck.hostname)
  if (!dnsCheck.ok) return dnsCheck

  return { ok: true, requestUrl: new URL(urlCheck.url).href, hostname: urlCheck.hostname }
}

module.exports = {
  parseAllowedHosts,
  isPrivateOrReservedIp,
  isHostnameAllowed,
  validateProxyTargetUrl,
  assertResolvedHostIsPublic,
  createProxyRedirectGuard,
  resolveSafeProxyRequestUrl,
}
