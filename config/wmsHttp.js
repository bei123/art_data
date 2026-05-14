/**
 * WMS 直连 HTTP（非 REBUILD /gw/api 签名网关）。在 .env 中配置基址与鉴权。
 */
require('dotenv').config()

function trimSlash(s) {
  return String(s || '').replace(/\/+$/, '')
}

const WMS_HTTP_BASE_URL = trimSlash(process.env.WMS_HTTP_BASE_URL || '')
const WMS_HTTP_BEARER_TOKEN = String(process.env.WMS_HTTP_BEARER_TOKEN || '').trim()
/** 可选：与 RB/WEB 登录接口配合，用于 wmsUserLoginFromEnv() */
const WMS_HTTP_USER = String(process.env.WMS_HTTP_USER || '').trim()
const WMS_HTTP_PASSWORD = String(process.env.WMS_HTTP_PASSWORD || '').trim()
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
  WMS_HTTP_PASSWORD,
  WMS_SYNC_PLACEHOLDER_IMAGE,
  WMS_HTTP_EXTRA_HEADERS_JSON,
  isWmsHttpConfigured,
  parseExtraHeaders,
}
