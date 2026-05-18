/**
 * WMS 原作图片：同步路径、管理端代理预览、采用后上传 OSS
 */
const axios = require('axios')
const path = require('path')
const db = require('../db')
const logger = require('../utils/logger')
const { uploadToOSS } = require('../config/oss')
const { bufferToWebpLimit5MB } = require('../utils/imageWebp')
const { validatePublicImageUrl } = require('../config/publicEnv')
const {
  WMS_HTTP_BASE_URL,
  WMS_HTTP_USER_AGENT,
  WMS_SYNC_PLACEHOLDER_IMAGE,
  WMS_IMAGE_CDN_ORIGIN,
  WMS_IMAGE_VIEW_PARAMS,
  WMS_IMAGE_PREVIEW_VIEW_PARAMS,
} = require('../config/wmsHttp')
const { isQiniuWmsConfigured, signQiniuPrivateImageUrl } = require('../config/qiniuWms')
const {
  wmsUserLoginFromEnv,
  clearWmsSessionCache,
  buildRbWebHeaders,
  wmsOrigin,
} = require('../utils/wmsHttpClient')

const WMS_FILEX_IMG_PREFIX = String(process.env.WMS_HTTP_FILEX_IMG_PREFIX || '/filex/img/').trim() || '/filex/img/'
const PREVIEW_IMAGE_CACHE_TTL_MS = 5 * 60 * 1000
const PREVIEW_CACHE_MAX_ENTRIES = Math.max(
  10,
  parseInt(process.env.WMS_PREVIEW_CACHE_MAX_ENTRIES || '80', 10) || 80
)
const PREVIEW_CACHE_MAX_BYTES = Math.max(
  4 * 1024 * 1024,
  parseInt(process.env.WMS_PREVIEW_CACHE_MAX_BYTES || String(48 * 1024 * 1024), 10) ||
    48 * 1024 * 1024
)
const APPLY_MAX_CONCURRENT = Math.min(
  3,
  Math.max(1, parseInt(process.env.WMS_APPLY_MAX_CONCURRENT || '1', 10) || 1)
)
const OUTBOUND_IMAGE_MAX_CONCURRENT = Math.min(
  8,
  Math.max(2, parseInt(process.env.WMS_IMAGE_OUTBOUND_MAX_CONCURRENT || '4', 10) || 4)
)
const OUTBOUND_IMAGE_MAX_BYTES = Math.max(
  8 * 1024 * 1024,
  parseInt(process.env.WMS_IMAGE_OUTBOUND_MAX_BYTES || String(20 * 1024 * 1024), 10) ||
    20 * 1024 * 1024
)

const previewImageCache = new Map()
let previewCacheTotalBytes = 0
const previewFetchInflight = new Map()
let applyActiveCount = 0
const applyWaitQueue = []
let outboundImageActive = 0
const outboundImageWaitQueue = []

function encodeWmsPathForUrl(relativePath) {
  const rel = normalizeWmsImagePath(relativePath)
  if (!rel) return ''
  return rel
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
}

function isRetryableNetworkError(err) {
  const code = String(err?.code || '')
  const msg = String(err?.message || '').toLowerCase()
  if (
    code === 'ECONNRESET' ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT' ||
    code === 'ERR_CANCELED' ||
    code === 'ERR_BAD_RESPONSE' ||
    code === 'EPIPE'
  ) {
    return true
  }
  return msg.includes('aborted') || msg.includes('socket hang up') || msg.includes('stream')
}

async function withOutboundImageSlot(run) {
  if (outboundImageActive >= OUTBOUND_IMAGE_MAX_CONCURRENT) {
    await new Promise((resolve) => {
      outboundImageWaitQueue.push(resolve)
    })
  }
  outboundImageActive += 1
  try {
    return await run()
  } finally {
    outboundImageActive -= 1
    const next = outboundImageWaitQueue.shift()
    if (next) next()
  }
}

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function cdnOrigin() {
  const base = String(WMS_IMAGE_CDN_ORIGIN || '').trim()
  if (!base) return ''
  return base.startsWith('http') ? base.replace(/\/+$/, '') : `http://${base.replace(/\/+$/, '')}`
}

function isAbsoluteImageUrl(raw) {
  return /^https?:\/\//i.test(String(raw || '').trim())
}

function resolveAbsoluteUrl(baseOrigin, location) {
  const loc = String(location || '').trim()
  if (!loc) return ''
  if (/^https?:\/\//i.test(loc)) return loc
  const base = String(baseOrigin || '').replace(/\/+$/, '')
  return loc.startsWith('/') ? `${base}${loc}` : `${base}/${loc}`
}

function normalizeWmsImagePath(raw) {
  if (raw == null || raw === '') return ''
  const s = String(raw).trim().replace(/^\/+/, '')
  if (!s || s.includes('..') || /^https?:\/\//i.test(s)) return ''
  return s
}

/** 从绝对 URL 中提取 rb/ 相对路径（用于签名过期后重试） */
function relativePathFromImageUrl(url) {
  if (!isAbsoluteImageUrl(url)) return ''
  try {
    const u = new URL(url)
    const p = u.pathname.replace(/^\/+/, '')
    if (p.startsWith('rb/')) return normalizeWmsImagePath(p)
  } catch {
    /* ignore */
  }
  const m = String(url).match(/\b(rb\/[^\s"'?<>]+\.(?:jpg|jpeg|png|webp|gif))/i)
  return m ? normalizeWmsImagePath(m[1]) : ''
}

function normalizeWmsImageRef(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  if (isAbsoluteImageUrl(s)) return s
  return normalizeWmsImagePath(s)
}

function parseWmsImagePathsColumn(raw) {
  if (raw == null || raw === '') return []
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(normalizeWmsImageRef).filter(Boolean))]
  }
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        return [...new Set(parsed.map(normalizeWmsImageRef).filter(Boolean))]
      }
    } catch {
      const one = normalizeWmsImageRef(raw)
      return one ? [one] : []
    }
  }
  return []
}

function stringifyWmsImagePaths(paths) {
  const list = [...new Set((paths || []).map(normalizeWmsImageRef).filter(Boolean))]
  return list.length ? JSON.stringify(list) : null
}

function placeholderImageUrl() {
  const fromEnv = String(WMS_SYNC_PLACEHOLDER_IMAGE || '').trim()
  if (fromEnv && validatePublicImageUrl(fromEnv)) return fromEnv
  return '/uploads/wms-sync-placeholder.png'
}

function isWmsSyncPlaceholderImage(url) {
  if (!url || typeof url !== 'string') return true
  const u = url.trim()
  if (!u) return true
  const ph = placeholderImageUrl()
  if (u === ph) return true
  if (u.includes('wms-sync-placeholder')) return true
  return false
}

/** 已发布到 OSS 的公开图（非 WMS 占位） */
function isPublishedOssArtworkImage(url) {
  if (!url || typeof url !== 'string') return false
  if (isWmsSyncPlaceholderImage(url)) return false
  return validatePublicImageUrl(url.trim())
}

/** 从任意 WMS 原始值（字符串/数组/对象/HTML）收集 rb/... 图片相对路径 */
function collectPathsFromValue(v) {
  const out = []
  if (v == null || v === '') return out

  if (Array.isArray(v)) {
    for (const item of v) {
      out.push(...collectPathsFromValue(item))
    }
    return [...new Set(out.map(normalizeWmsImagePath).filter(Boolean))]
  }

  if (typeof v === 'object') {
    for (const key of ['url', 'path', 'name', 'file', 'key', 'value', 'text']) {
      if (typeof v[key] === 'string') out.push(...pathsFromRawString(v[key]))
    }
    return [...new Set(out.map(normalizeWmsImagePath).filter(Boolean))]
  }

  if (typeof v === 'string') {
    return pathsFromRawString(v)
  }

  return out
}

function pathsFromRawString(raw) {
  const str = String(raw ?? '').trim()
  if (!str) return []

  if (str.startsWith('[') || str.startsWith('{')) {
    try {
      const parsed = JSON.parse(str)
      const fromJson = collectPathsFromValue(parsed)
      if (fromJson.length) return fromJson
    } catch {
      /* 非 JSON，继续按文本解析 */
    }
  }

  const out = []
  const urlRe = /(https?:\/\/[^\s"'<>]+\/rb\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp|gif)[^\s"'<>]*)/gi
  let urlMatch = urlRe.exec(str)
  while (urlMatch) {
    const u = String(urlMatch[1]).trim()
    if (u) out.push(u)
    urlMatch = urlRe.exec(str)
  }

  const re = /\b(rb\/[^\s"',<>]+\.(?:jpg|jpeg|png|webp|gif))\b/gi
  let match = re.exec(str)
  while (match) {
    const p = normalizeWmsImagePath(match[1])
    if (p) out.push(p)
    match = re.exec(str)
  }
  if (out.length) return [...new Set(out)]

  if (!str.includes('<') && !str.includes('>')) {
    const one = normalizeWmsImagePath(str)
    return one ? [one] : []
  }

  return out
}

function extractWmsImagePathsFromElement(el) {
  if (!el) return []
  let out = collectPathsFromValue(el.value)
  if (!out.length && typeof el.text === 'string') out = pathsFromRawString(el.text)
  if (!out.length && typeof el.html === 'string') out = pathsFromRawString(el.html)
  return out
}

function dataCellsFromListRow(row) {
  if (!Array.isArray(row) || row.length === 0) return []
  const last = row[row.length - 1]
  if (last && typeof last === 'object' && last.entity === 'Product' && last.id) return row.slice(0, -1)
  return row
}

function extractWmsImagePathsFromListRow(row, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return []
  const idx = fields.indexOf('zuopintupian')
  if (idx < 0) return []
  const cells = dataCellsFromListRow(row)
  if (idx >= cells.length) return []
  const cell = cells[idx]
  return collectPathsFromValue(cell)
}

function wmsImagePathsEqual(a, b) {
  const norm = (list) =>
    [...(list || [])]
      .map((item) => {
        if (isAbsoluteImageUrl(item)) return relativePathFromImageUrl(item) || String(item)
        return normalizeWmsImagePath(item)
      })
      .filter(Boolean)
      .sort()
  const left = norm(a)
  const right = norm(b)
  if (left.length !== right.length) return false
  return left.every((p, i) => p === right[i])
}

/**
 * @param {object[]} elements
 * @param {{ row?: unknown[], fields?: string[] } | null | undefined} listHint
 */
function extractWmsImagePaths(elements, listHint) {
  const fromEl = extractWmsImagePathsFromElement(
    Array.isArray(elements) ? elements.find((e) => e && e.field === 'zuopintupian') : null
  )
  if (fromEl.length) return fromEl
  if (listHint && Array.isArray(listHint.row) && Array.isArray(listHint.fields)) {
    return extractWmsImagePathsFromListRow(listHint.row, listHint.fields)
  }
  return []
}

/** REBUILD：带登录态访问 filex，通常会 302 到 qn 带 token 的地址 */
function buildWmsFilexImgUrl(relativePath) {
  const origin = wmsOrigin()
  const rel = encodeWmsPathForUrl(relativePath)
  if (!origin || !rel) return ''
  const prefix = WMS_FILEX_IMG_PREFIX.startsWith('/') ? WMS_FILEX_IMG_PREFIX : `/${WMS_FILEX_IMG_PREFIX}`
  return `${origin}${prefix}${rel}`
}

function buildWmsFilexReadUrl(relativePath) {
  const origin = wmsOrigin()
  const rel = encodeWmsPathForUrl(relativePath)
  if (!origin || !rel) return ''
  return `${origin}/filex/read/${rel}`
}

function buildCdnImageUrl(relativePath, withViewParams = true, viewParamsOverride) {
  const cdn = cdnOrigin()
  const rel = encodeWmsPathForUrl(relativePath)
  if (!cdn || !rel) return ''
  const base = `${cdn}/${rel}`
  const params =
    viewParamsOverride !== undefined
      ? viewParamsOverride
      : withViewParams
        ? WMS_IMAGE_VIEW_PARAMS
        : ''
  if (!params) return base
  return `${base}?${params}`
}

function cdnImageGetHeaders() {
  const wms = wmsOrigin()
  return {
    Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    Referer: `${wms}/`,
    'User-Agent': WMS_HTTP_USER_AGENT,
  }
}

/** 七牛私有桶签名 URL 不可随意改 query，否则 token 失效 → 401 */
function isSignedQiniuUrl(url) {
  const s = String(url || '')
  return /[?&]token=/i.test(s) || /[?&]e=\d+/i.test(s)
}

function imageGetHeaders(cookie, refererPath = '/app/Product/list') {
  const headers = buildRbWebHeaders({
    refererPath,
    cookie: String(cookie || '').trim(),
    userAgent: WMS_HTTP_USER_AGENT,
  })
  delete headers['Content-Type']
  headers.Accept = 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
  return headers
}

async function httpGetImageBufferOnce(url, headers) {
  const res = await axios.get(url, {
    headers,
    responseType: 'arraybuffer',
    timeout: 90000,
    maxRedirects: 10,
    maxContentLength: OUTBOUND_IMAGE_MAX_BYTES,
    maxBodyLength: OUTBOUND_IMAGE_MAX_BYTES,
    decompress: true,
    validateStatus: () => true,
  })
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`拉取 WMS 图片失败 HTTP ${res.status}`)
    err.code = 'WMS_IMAGE_HTTP'
    err.status = res.status
    throw err
  }
  const buffer = Buffer.from(res.data)
  if (!buffer.length) {
    const err = new Error('WMS 图片为空')
    err.code = 'WMS_IMAGE_EMPTY'
    throw err
  }
  if (buffer.length > OUTBOUND_IMAGE_MAX_BYTES) {
    const err = new Error('WMS 图片过大')
    err.code = 'WMS_IMAGE_TOO_LARGE'
    throw err
  }
  const contentType = String(res.headers['content-type'] || 'image/jpeg').split(';')[0].trim()
  return { buffer, contentType, url: res.request?.res?.responseUrl || url }
}

async function httpGetImageBuffer(url, headers) {
  return withOutboundImageSlot(async () => {
    try {
      return await httpGetImageBufferOnce(url, headers)
    } catch (e) {
      if (!isRetryableNetworkError(e)) throw e
      await new Promise((r) => setTimeout(r, 400))
      return await httpGetImageBufferOnce(url, headers)
    }
  })
}

/** 先 HEAD/GET 不跟随重定向，拿到 qn 签名 URL */
async function resolveSignedCdnUrlViaFilex(cookie, relativePath) {
  const filexUrl = buildWmsFilexImgUrl(relativePath)
  if (!filexUrl) return ''
  const res = await axios.get(filexUrl, {
    headers: imageGetHeaders(cookie),
    maxRedirects: 0,
    validateStatus: () => true,
    timeout: 30000,
  })
  if ((res.status === 301 || res.status === 302 || res.status === 303) && res.headers.location) {
    const loc = String(res.headers.location).trim()
    if (/^https?:\/\//i.test(loc)) return loc
    return resolveAbsoluteUrl(wmsOrigin(), loc)
  }
  if (res.status >= 200 && res.status < 300) return filexUrl
  return ''
}

async function fetchViaWmsFilex(cookie, relativePath) {
  const filexUrl = buildWmsFilexImgUrl(relativePath)
  if (!filexUrl) {
    const err = new Error('无效的 WMS 图片路径')
    err.code = 'WMS_IMAGE_BAD_PATH'
    throw err
  }
  return httpGetImageBuffer(filexUrl, imageGetHeaders(cookie))
}

async function fetchViaSignedCdn(cookie, relativePath) {
  const signed = await resolveSignedCdnUrlViaFilex(cookie, relativePath)
  if (!signed) {
    const err = new Error('无法从 WMS 获取图片签名地址')
    err.code = 'WMS_IMAGE_NO_SIGN'
    throw err
  }
  return httpGetImageBuffer(signed, cdnImageGetHeaders())
}

/** filex 302 到 CDN 后带 WMS Referer 拉取（不破坏签名） */
async function fetchViaFilexRedirectToCdn(cookie, relativePath) {
  const signed = await resolveSignedCdnUrlViaFilex(cookie, relativePath)
  if (!signed || !/^https?:\/\//i.test(signed)) {
    const err = new Error('无法从 WMS 获取图片签名地址')
    err.code = 'WMS_IMAGE_NO_SIGN'
    throw err
  }
  return httpGetImageBuffer(signed, cdnImageGetHeaders())
}

async function fetchViaWmsFilexRead(cookie, relativePath) {
  const readUrl = buildWmsFilexReadUrl(relativePath)
  if (!readUrl) {
    const err = new Error('无效的 WMS 图片路径')
    err.code = 'WMS_IMAGE_BAD_PATH'
    throw err
  }
  return httpGetImageBuffer(readUrl, imageGetHeaders(cookie))
}

/** 七牛 AK/SK 自签：先 imageView2 再 e/token（见七牛私有空间带样式授权文档） */
async function fetchViaQiniuSigned(relativePath, variant) {
  const viewParams =
    variant === 'preview' ? WMS_IMAGE_PREVIEW_VIEW_PARAMS : WMS_IMAGE_VIEW_PARAMS
  const signed = signQiniuPrivateImageUrl(relativePath, viewParams)
  if (!signed) {
    const err = new Error('七牛签名未配置或路径无效')
    err.code = 'QINIU_SIGN_FAILED'
    throw err
  }
  return httpGetImageBuffer(signed, cdnImageGetHeaders())
}

async function fetchWmsImageBufferOnce(cookie, imageRef, variant) {
  const ref = String(imageRef || '').trim()
  if (!ref) {
    const err = new Error('无效的 WMS 图片路径')
    err.code = 'WMS_IMAGE_BAD_PATH'
    throw err
  }

  if (isAbsoluteImageUrl(ref)) {
    const relFromAbs = relativePathFromImageUrl(ref)
    if (relFromAbs && isQiniuWmsConfigured()) {
      try {
        return await fetchViaQiniuSigned(relFromAbs, variant)
      } catch (e) {
        logger.warn('wms_image_qiniu_from_absolute_failed', {
          rel: relFromAbs,
          variant,
          err: e.message,
        })
      }
    }
    if (!isSignedQiniuUrl(ref)) {
      try {
        return await httpGetImageBuffer(ref, cdnImageGetHeaders())
      } catch (e) {
        if (!relFromAbs) throw e
        logger.warn('wms_image_absolute_fetch_failed', { ref: relFromAbs, err: e.message })
      }
    } else if (relFromAbs) {
      logger.info('wms_image_signed_absolute_use_rel', { ref: relFromAbs, variant })
    }
  }

  const rel = isAbsoluteImageUrl(ref) ? relativePathFromImageUrl(ref) : normalizeWmsImagePath(ref)
  if (!rel) {
    const err = new Error('无效的 WMS 图片路径')
    err.code = 'WMS_IMAGE_BAD_PATH'
    throw err
  }

  const attempts = []
  if (isQiniuWmsConfigured()) {
    attempts.push(() => fetchViaQiniuSigned(rel, variant))
  }
  attempts.push(
    () => fetchViaFilexRedirectToCdn(cookie, rel),
    () => fetchViaWmsFilex(cookie, rel),
    () => fetchViaSignedCdn(cookie, rel),
    () => fetchViaWmsFilexRead(cookie, rel)
  )

  let lastErr
  for (const run of attempts) {
    try {
      return await run()
    } catch (e) {
      lastErr = e
      const level = isRetryableNetworkError(e) ? 'info' : 'warn'
      logger[level]('wms_image_fetch_attempt_failed', {
        rel,
        variant,
        code: e.code,
        status: e.status,
        err: e.message,
      })
    }
  }

  throw lastErr || new Error('拉取 WMS 图片失败')
}

/**
 * @param {string} cookie
 * @param {string} imageRef 相对路径 rb/... 或完整 qn 签名 URL
 * @param {{ variant?: 'preview' | 'full' }} [options]
 */
async function fetchWmsImageBuffer(cookie, imageRef, options = {}) {
  const variant = options.variant === 'preview' ? 'preview' : 'full'
  try {
    return await fetchWmsImageBufferOnce(cookie, imageRef, variant)
  } catch (e) {
    if (e.status !== 401 && e.status !== 403) throw e
    logger.warn('wms_image_auth_retry', { status: e.status, variant })
    clearWmsSessionCache()
    const { sessionCookie } = await wmsUserLoginFromEnv()
    const fresh = sessionCookie || ''
    if (!fresh) throw e
    return fetchWmsImageBufferOnce(fresh, imageRef, variant)
  }
}

function previewCacheKey(artworkId, index, imageRef) {
  const rel = isAbsoluteImageUrl(imageRef)
    ? relativePathFromImageUrl(imageRef) || imageRef
    : normalizeWmsImagePath(imageRef)
  return `${artworkId}:${index}:${rel}`
}

function evictPreviewCacheEntry(key) {
  const hit = previewImageCache.get(key)
  if (!hit) return
  previewImageCache.delete(key)
  previewCacheTotalBytes = Math.max(0, previewCacheTotalBytes - (hit.byteSize || 0))
}

function pruneExpiredPreviewCache() {
  const now = Date.now()
  for (const [key, hit] of previewImageCache.entries()) {
    if (hit.expiresAt <= now) evictPreviewCacheEntry(key)
  }
}

function enforcePreviewCacheLimits() {
  pruneExpiredPreviewCache()
  while (
    previewImageCache.size > PREVIEW_CACHE_MAX_ENTRIES ||
    previewCacheTotalBytes > PREVIEW_CACHE_MAX_BYTES
  ) {
    const oldest = previewImageCache.keys().next().value
    if (oldest === undefined) break
    evictPreviewCacheEntry(oldest)
  }
}

function getPreviewFromCache(key) {
  pruneExpiredPreviewCache()
  const hit = previewImageCache.get(key)
  if (!hit) return null
  if (hit.expiresAt <= Date.now()) {
    evictPreviewCacheEntry(key)
    return null
  }
  previewImageCache.delete(key)
  previewImageCache.set(key, hit)
  return hit
}

function setPreviewCache(key, buffer, contentType) {
  const byteSize = buffer?.length || 0
  if (previewImageCache.has(key)) evictPreviewCacheEntry(key)
  previewImageCache.set(key, {
    buffer,
    contentType,
    byteSize,
    expiresAt: Date.now() + PREVIEW_IMAGE_CACHE_TTL_MS,
  })
  previewCacheTotalBytes += byteSize
  enforcePreviewCacheLimits()
}

function clearPreviewCacheForArtwork(artworkId) {
  const prefix = `${artworkId}:`
  for (const key of [...previewImageCache.keys()]) {
    if (key.startsWith(prefix)) evictPreviewCacheEntry(key)
  }
}

async function withApplyConcurrency(run) {
  if (applyActiveCount >= APPLY_MAX_CONCURRENT) {
    await new Promise((resolve) => {
      applyWaitQueue.push(resolve)
    })
  }
  applyActiveCount += 1
  try {
    return await run()
  } finally {
    applyActiveCount -= 1
    const next = applyWaitQueue.shift()
    if (next) next()
  }
}

async function fetchPreviewImageBuffer(cookie, rel, cacheKey) {
  if (previewFetchInflight.has(cacheKey)) return previewFetchInflight.get(cacheKey)

  const task = fetchWmsImageBuffer(cookie, rel, { variant: 'preview' }).finally(() => {
    previewFetchInflight.delete(cacheKey)
  })
  previewFetchInflight.set(cacheKey, task)
  return task
}

function extFromContentType(contentType, imageRef) {
  const map = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
  }
  if (contentType && map[contentType.toLowerCase()]) return map[contentType.toLowerCase()]
  const pathForExt = isAbsoluteImageUrl(imageRef)
    ? relativePathFromImageUrl(imageRef) || imageRef
    : imageRef
  const ext = path.extname(pathForExt || '').toLowerCase()
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext
  return '.jpg'
}

/**
 * 管理端：代理输出 WMS 图片（需 WMS 登录 Cookie）
 */
function isClientDisconnected(req, res) {
  if (res?.writableEnded || res?.destroyed) return true
  return Boolean(req?.aborted || req?.destroyed)
}

async function streamWmsArtworkImageAdmin(artworkId, query, res, req) {
  const id = parseInt(String(artworkId), 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的作品ID' })
  }
  const index = Math.max(0, parseInt(String(query?.index ?? 0), 10) || 0)
  let clientGone = false
  if (req) {
    req.on('close', () => {
      clientGone = true
    })
  }

  const [rows] = await db.query(
    'SELECT id, wms_image_paths FROM original_artworks WHERE id = ? LIMIT 1',
    [id]
  )
  if (!rows.length) return adminResult(404, { error: '作品不存在' })

  const paths = parseWmsImagePathsColumn(rows[0].wms_image_paths)
  if (!paths.length) return adminResult(404, { error: '无仓库图片' })
  const rel = paths[index] || paths[0]
  const cacheKey = previewCacheKey(id, index, rel)
  const cached = getPreviewFromCache(cacheKey)
  if (cached) {
    if (isClientDisconnected(req, res) || clientGone) return null
    res.setHeader('Content-Type', cached.contentType || 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(cached.buffer)
    return null
  }

  try {
    let cookie = ''
    if (!isQiniuWmsConfigured()) {
      const { sessionCookie } = await wmsUserLoginFromEnv()
      cookie = sessionCookie || ''
      if (!cookie) return adminResult(502, { error: 'WMS 登录未返回会话' })
    }

    const { buffer, contentType } = await fetchPreviewImageBuffer(cookie, rel, cacheKey)
    if (clientGone || isClientDisconnected(req, res)) return null
    setPreviewCache(cacheKey, buffer, contentType)
    res.setHeader('Content-Type', contentType || 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.send(buffer)
    return null
  } catch (e) {
    if (clientGone || isClientDisconnected(req, res)) return null
    if (isRetryableNetworkError(e)) {
      logger.info('streamWmsArtworkImageAdmin_network', { id, rel, err: e.message })
    } else {
      logger.error('streamWmsArtworkImageAdmin_failed', { id, rel, err: e.message })
    }
    if (e.code === 'WMS_HTTP_NOT_CONFIGURED' || e.code === 'WMS_HTTP_BAD_REQUEST') {
      return adminResult(400, { error: e.message })
    }
    return adminResult(502, { error: e.message || '拉取仓库图片失败' })
  }
}

/**
 * 管理端：将仓库图上传 OSS 并写入 original_artworks.image（对外展示）
 */
async function applyWmsImageToArtworkAdmin(artworkId, body) {
  const id = parseInt(String(artworkId), 10)
  if (Number.isNaN(id) || id <= 0) {
    return adminResult(400, { error: '无效的作品ID' })
  }
  const index = Math.max(0, parseInt(String(body?.index ?? 0), 10) || 0)

  const [rows] = await db.query(
    'SELECT id, title, image, wms_image_paths FROM original_artworks WHERE id = ? LIMIT 1',
    [id]
  )
  if (!rows.length) return adminResult(404, { error: '作品不存在' })

  const paths = parseWmsImagePathsColumn(rows[0].wms_image_paths)
  if (!paths.length) return adminResult(400, { error: '该作品无仓库图片，请先 WMS 同步' })

  const rel = paths[index] || paths[0]

  try {
    return await withApplyConcurrency(async () => {
      let cookie = ''
      if (!isQiniuWmsConfigured()) {
        const { sessionCookie } = await wmsUserLoginFromEnv()
        cookie = sessionCookie || ''
        if (!cookie) return adminResult(502, { error: 'WMS 登录未返回会话' })
      }

      const { buffer } = await fetchWmsImageBuffer(cookie, rel, { variant: 'full' })
      const webpFile = await bufferToWebpLimit5MB(buffer, `wms-${id}`)
      const upload = await uploadToOSS(webpFile, 'original-artworks/')

      if (!upload?.url || !validatePublicImageUrl(upload.url)) {
        return adminResult(500, { error: '上传到 OSS 后 URL 无效' })
      }

      await db.query('UPDATE original_artworks SET image = ? WHERE id = ?', [upload.url, id])
      clearPreviewCacheForArtwork(id)
      const { invalidateArtworksPublicCaches } = require('./artworksService')
      await invalidateArtworksPublicCaches({ artworkDetailIds: [id] })

      return adminResult(200, {
        message: '已采用仓库图片（WebP 压缩）并发布到 OSS',
        image: upload.url,
        wms_path: rel,
      })
    })
  } catch (e) {
    logger.error('applyWmsImageToArtworkAdmin_failed', { id, rel, err: e.message })
    if (e.code === 'WMS_HTTP_NOT_CONFIGURED' || e.code === 'WMS_HTTP_BAD_REQUEST') {
      return adminResult(400, { error: e.message })
    }
    if (e.code === 'IMAGE_TOO_LARGE' || e.code === 'IMAGE_EMPTY') {
      return adminResult(400, { error: e.message })
    }
    return adminResult(502, { error: e.message || '采用仓库图片失败' })
  }
}

function attachAdminWmsImageFields(row) {
  if (!row) return row
  const wms_image_paths = parseWmsImagePathsColumn(row.wms_image_paths)
  return {
    ...row,
    wms_image_paths,
    has_wms_image: wms_image_paths.length > 0,
    image_is_placeholder: isWmsSyncPlaceholderImage(row.image),
    image_is_published: isPublishedOssArtworkImage(row.image),
  }
}

function stripWmsFieldsForPublic(row) {
  if (!row || typeof row !== 'object') return row
  const { wms_image_paths, has_wms_image, image_is_placeholder, image_is_published, ...rest } = row
  return rest
}

module.exports = {
  normalizeWmsImagePath,
  parseWmsImagePathsColumn,
  stringifyWmsImagePaths,
  wmsImagePathsEqual,
  collectPathsFromValue,
  buildCdnImageUrl,
  placeholderImageUrl,
  isWmsSyncPlaceholderImage,
  isPublishedOssArtworkImage,
  extractWmsImagePaths,
  buildWmsFilexImgUrl,
  streamWmsArtworkImageAdmin,
  applyWmsImageToArtworkAdmin,
  attachAdminWmsImageFields,
  stripWmsFieldsForPublic,
}
