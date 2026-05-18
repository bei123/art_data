/**
 * WMS 仓库图所在七牛私有桶：用 AK/SK 生成带 imageView2 的下载外链。
 * 签名规则见 https://developer.qiniu.com/kodo/kb/4069/take-pictures-style-file-authorization-private-space
 */
require('dotenv').config()

const qiniu = require('qiniu')
const { WMS_IMAGE_CDN_ORIGIN } = require('./wmsHttp')

const QINIU_ACCESS_KEY = String(process.env.QINIU_ACCESS_KEY || '').trim()
const QINIU_SECRET_KEY = String(process.env.QINIU_SECRET_KEY || '').trim()
const QINIU_PRIVATE_URL_EXPIRES_SEC = Math.max(
  60,
  parseInt(process.env.QINIU_PRIVATE_URL_EXPIRES_SEC || '3600', 10) || 3600
)

function isQiniuWmsConfigured() {
  return Boolean(QINIU_ACCESS_KEY && QINIU_SECRET_KEY && cdnDomain())
}

function cdnDomain() {
  const base = String(WMS_IMAGE_CDN_ORIGIN || '').trim()
  if (!base) return ''
  return base.startsWith('http') ? base.replace(/\/+$/, '') : `http://${base.replace(/\/+$/, '')}`
}

/** 与 HTTP 请求一致：仅对路径段做 encodeURIComponent */
function encodeObjectKeyForUrl(key) {
  return String(key || '')
    .replace(/^\/+/, '')
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

/**
 * 生成私有下载 URL（先拼 imageView2，再拼 e、token）
 * @param {string} objectKey 桶内 key，如 rb/2024/xxx.jpg
 * @param {string} [viewParams] 如 imageView2/2/w/400/...
 * @returns {string}
 */
function signQiniuPrivateImageUrl(objectKey, viewParams) {
  if (!isQiniuWmsConfigured()) return ''
  const domain = cdnDomain()
  const rawKey = String(objectKey || '').replace(/^\/+/, '')
  if (!domain || !rawKey) return ''

  let keyWithQuery = encodeObjectKeyForUrl(rawKey)
  const params = String(viewParams || '').trim().replace(/^\?/, '')
  if (params) {
    keyWithQuery += keyWithQuery.includes('?') ? `&${params}` : `?${params}`
  }

  const deadline = Math.floor(Date.now() / 1000) + QINIU_PRIVATE_URL_EXPIRES_SEC
  keyWithQuery += keyWithQuery.includes('?') ? `&e=${deadline}` : `?e=${deadline}`

  const data = `${domain}/${keyWithQuery}`
  const digest = qiniu.util.hmacSha1(data, QINIU_SECRET_KEY)
  const safeDigest = qiniu.util.base64ToUrlSafe(digest)
  return `${data}&token=${QINIU_ACCESS_KEY}:${safeDigest}`
}

module.exports = {
  QINIU_ACCESS_KEY,
  QINIU_PRIVATE_URL_EXPIRES_SEC,
  isQiniuWmsConfigured,
  signQiniuPrivateImageUrl,
  encodeObjectKeyForUrl,
}
