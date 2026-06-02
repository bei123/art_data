import {
  isOssPublicUrl,
  OSS_PUBLIC_HOST,
  resolvePublicAssetUrl,
} from '@/config'

const DEFAULT_LIST_WIDTH = Math.max(
  64,
  Number(import.meta.env.VITE_LIST_IMAGE_WIDTH) || 240
)
const DEFAULT_LIST_QUALITY = Math.min(
  100,
  Math.max(40, Number(import.meta.env.VITE_LIST_IMAGE_QUALITY) || 80)
)

function parseOriginList(raw, fallback) {
  const text = String(raw || fallback || '').trim()
  if (!text) return []
  return text
    .split(',')
    .map((part) => part.trim().replace(/\/+$/, ''))
    .filter(Boolean)
}

const QINIU_CDN_ORIGINS = parseOriginList(
  import.meta.env.VITE_QINIU_CDN_ORIGINS,
  'http://qn.2000gallery.art,https://qn.2000gallery.art'
)

/** 七牛私有空间签名链不可改 query，否则 401 */
export function isSignedQiniuUrl(url) {
  const s = String(url || '')
  return /[?&]token=/i.test(s) || /[?&]e=\d/i.test(s)
}

function isAliyunOssUrl(url) {
  if (isOssPublicUrl(url)) return true
  try {
    const host = new URL(url).hostname
    if (host === OSS_PUBLIC_HOST) return true
    return /\.aliyuncs\.com$/i.test(host)
  } catch {
    return false
  }
}

function isQiniuCdnUrl(url) {
  if (!url || !String(url).startsWith('http')) return false
  try {
    const parsed = new URL(url)
    const origin = `${parsed.protocol}//${parsed.host}`
    if (QINIU_CDN_ORIGINS.some((item) => origin === item || url.startsWith(`${item}/`))) {
      return true
    }
    return /^qn\./i.test(parsed.hostname) || parsed.hostname.includes('qiniucdn')
  } catch {
    return false
  }
}

function appendQueryParam(url, param) {
  if (!param) return url
  if (/[?&]imageView2\//i.test(url) || /x-oss-process=/i.test(url)) return url
  return url.includes('?') ? `${url}&${param}` : `${url}?${param}`
}

function buildOssListProcess(width, quality) {
  return `x-oss-process=image/resize,w_${width},m_lfit/quality,q_${quality}/format,jpg`
}

function buildQiniuListView(width, quality) {
  return `imageView2/2/w/${width}/interlace/1/q/${quality}`
}

/**
 * 列表/表格缩略图：阿里 OSS 用 x-oss-process，七牛用 imageView2；本地上传路径仅解析为绝对地址。
 * @param {string} url
 * @param {{ width?: number, quality?: number }} [options]
 */
export function getListThumbnailUrl(url, options = {}) {
  if (!url || typeof url !== 'string') return ''

  const width = Math.max(48, Number(options.width) || DEFAULT_LIST_WIDTH)
  const quality = Math.min(
    100,
    Math.max(40, Number(options.quality) || DEFAULT_LIST_QUALITY)
  )

  const absolute = resolvePublicAssetUrl(url)
  if (!absolute.startsWith('http')) return absolute

  if (isAliyunOssUrl(absolute)) {
    return appendQueryParam(absolute, buildOssListProcess(width, quality))
  }

  if (isQiniuCdnUrl(absolute)) {
    if (isSignedQiniuUrl(absolute)) return absolute
    return appendQueryParam(absolute, buildQiniuListView(width, quality))
  }

  return absolute
}
