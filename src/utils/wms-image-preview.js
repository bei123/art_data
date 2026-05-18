import { API_BASE_URL } from '../config'

const CACHE_MAX_ENTRIES = 80
const MAX_CONCURRENT_FETCHES = 3

/** @type {Map<string, string>} */
const blobUrlCache = new Map()
/** @type {Map<string, Promise<string>>} */
const inflightFetches = new Map()
let activeFetches = 0
/** @type {Array<() => void>} */
const fetchWaitQueue = []

function cacheKey(artworkId, index) {
  return `${artworkId}:${index}`
}

function trimTrailingSlash(s) {
  return String(s || '').replace(/\/+$/, '')
}

/**
 * 管理端 WMS 图代理地址（img 可直接使用，走浏览器缓存；支持 query.token）
 */
export function buildWmsAdminImageUrl(artworkId, index = 0) {
  const id = Number(artworkId)
  if (!id || id <= 0) return ''
  const base = trimTrailingSlash(API_BASE_URL)
  const token = localStorage.getItem('token') || ''
  const params = new URLSearchParams({ index: String(Math.max(0, index)) })
  if (token) params.set('token', token)
  return `${base}/api/original-artworks/${id}/admin/wms-image?${params}`
}

function evictBlobCacheIfNeeded() {
  while (blobUrlCache.size > CACHE_MAX_ENTRIES) {
    const oldest = blobUrlCache.keys().next().value
    if (oldest === undefined) break
    const url = blobUrlCache.get(oldest)
    blobUrlCache.delete(oldest)
    revokeWmsImageObjectUrl(url)
  }
}

function runNextFetch() {
  const next = fetchWaitQueue.shift()
  if (next) next()
}

function withFetchSlot(run) {
  if (activeFetches >= MAX_CONCURRENT_FETCHES) {
    return new Promise((resolve) => {
      fetchWaitQueue.push(() => {
        resolve(withFetchSlot(run))
      })
    })
  }
  activeFetches += 1
  return Promise.resolve()
    .then(run)
    .finally(() => {
      activeFetches -= 1
      runNextFetch()
    })
}

/**
 * 拉取为 blob URL（仅在直连 img 失败时使用）；带内存缓存与并发限制
 */
export async function fetchWmsImageObjectUrl(artworkId, index = 0, options = {}) {
  const id = Number(artworkId)
  if (!id || id <= 0) throw new Error('无效的作品ID')

  const key = cacheKey(id, index)
  const cached = blobUrlCache.get(key)
  if (cached) return cached

  if (inflightFetches.has(key)) return inflightFetches.get(key)

  const task = withFetchSlot(async () => {
    const hit = blobUrlCache.get(key)
    if (hit) return hit

    const token = localStorage.getItem('token') || ''
    const url = buildWmsAdminImageUrl(id, index)

    const res = await fetch(url, {
      method: 'GET',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
      signal: options.signal,
    })

    if (!res.ok) {
      let message = `仓库图加载失败 (${res.status})`
      try {
        const errBody = await res.json()
        if (errBody?.error) message = errBody.error
      } catch {
        /* 非 JSON */
      }
      throw new Error(message)
    }

    const blob = await res.blob()
    if (!blob.size) throw new Error('仓库图为空')
    if (blob.type && blob.type.includes('json')) {
      throw new Error('仓库图加载失败')
    }

    const objectUrl = URL.createObjectURL(blob)
    blobUrlCache.set(key, objectUrl)
    evictBlobCacheIfNeeded()
    return objectUrl
  }).finally(() => {
    inflightFetches.delete(key)
  })

  inflightFetches.set(key, task)
  return task
}

export function revokeWmsImageObjectUrl(objectUrl) {
  if (objectUrl && String(objectUrl).startsWith('blob:')) {
    URL.revokeObjectURL(objectUrl)
  }
}

/** 清除某作品的 blob 缓存（如采用仓库图后） */
export function invalidateWmsImageCache(artworkId) {
  const prefix = `${artworkId}:`
  for (const key of [...blobUrlCache.keys()]) {
    if (!key.startsWith(prefix)) continue
    revokeWmsImageObjectUrl(blobUrlCache.get(key))
    blobUrlCache.delete(key)
  }
}
