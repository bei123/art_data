/**
 * WMS 直连 HTTP（非 REBUILD /gw/api 签名网关）。在 .env 中配置基址与鉴权。
 *
 * 登录失败「用户名或密码错误」常见原因：
 * - .env 里密码含 # 或行首有空格，未用双引号导致被截断或读错
 * - 与浏览器不一致：WMS 要求「登录名」而 .env 填了邮箱（或相反），以 Web 登录页实际输入为准
 * - 密码含特殊字符：可用 WMS_HTTP_PASSWORD_B64（UTF-8 明文做 base64，无换行）
 * - REBUILD 约定：URL 中 passwd 为占位 ******，真实密码在 POST body；客户端须与之一致（见 wmsHttpClient.wmsUserLogin）
 */
require('dotenv').config()

function trimSlash(s) {
  return String(s || '').replace(/\/+$/, '')
}

const WMS_HTTP_BASE_URL = trimSlash(process.env.WMS_HTTP_BASE_URL || '')
const WMS_HTTP_BEARER_TOKEN = String(process.env.WMS_HTTP_BEARER_TOKEN || '').trim()
/** 与 Web 登录框一致（多为邮箱或登录名） */
const WMS_HTTP_USER = String(process.env.WMS_HTTP_USER || '').trim()

/**
 * 登录用密码：优先 WMS_HTTP_PASSWORD_B64（base64），否则 WMS_HTTP_PASSWORD 原样（不 trim，避免误伤）。
 * 与 REBUILD 网页一致：该明文由 wmsUserLogin 写入 POST body，而非 URL 查询串。
 */
function getWmsHttpPasswordForLogin() {
  const b64 = String(process.env.WMS_HTTP_PASSWORD_B64 || '').trim()
  if (b64) {
    try {
      return Buffer.from(b64, 'base64').toString('utf8')
    } catch {
      return ''
    }
  }
  return String(process.env.WMS_HTTP_PASSWORD ?? '')
}

/** 可选：WMS 同步新建原作时的占位图 URL（须通过 validatePublicImageUrl） */
const WMS_SYNC_PLACEHOLDER_IMAGE = String(process.env.WMS_SYNC_PLACEHOLDER_IMAGE || '').trim()
/** 可选：JSON 字符串，合并进请求头，如 {"X-Api-Key":"xxx"} */
const WMS_HTTP_EXTRA_HEADERS_JSON = String(process.env.WMS_HTTP_EXTRA_HEADERS_JSON || '').trim()

function isWmsHttpConfigured() {
  return Boolean(WMS_HTTP_BASE_URL)
}

function parseExtraHeaders() {
  if (!WMS_HTTP_EXTRA_HEADERS_JSON) return {}
  try {
    const o = JSON.parse(WMS_HTTP_EXTRA_HEADERS_JSON)
    return o && typeof o === 'object' && !Array.isArray(o) ? o : {}
  } catch {
    return {}
  }
}

module.exports = {
  WMS_HTTP_BASE_URL,
  WMS_HTTP_BEARER_TOKEN,
  WMS_HTTP_USER,
  getWmsHttpPasswordForLogin,
  WMS_SYNC_PLACEHOLDER_IMAGE,
  WMS_HTTP_EXTRA_HEADERS_JSON,
  isWmsHttpConfigured,
  parseExtraHeaders,
}
