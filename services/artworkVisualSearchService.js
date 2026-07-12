const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const { buildArtworkMarkerLiveUrl } = require('../utils/artworkArMarker')
const {
  computeDifferenceHashFromBuffer,
  hammingDistance,
  confidenceFromDistance,
} = require('../utils/artworkImageHash')

const EXHIBITIONS_TABLE = 'exhibitions'
const EXHIBITION_ITEMS_TABLE = 'exhibition_items'
const ORIGINAL_ARTWORKS_TABLE = 'original_artworks'
const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external'

const HASH_CACHE_PREFIX = 'artwork:visual_hash:'
const HASH_CACHE_TTL_SEC = 7 * 24 * 60 * 60
const MATCH_THRESHOLD = Math.min(
  32,
  Math.max(8, Number(process.env.ARTWORK_VISUAL_MATCH_THRESHOLD) || 16)
)
const AMBIGUOUS_GAP = Math.max(2, Number(process.env.ARTWORK_VISUAL_AMBIGUOUS_GAP) || 4)
const FETCH_TIMEOUT_MS = Math.min(15000, Math.max(3000, Number(process.env.ARTWORK_VISUAL_FETCH_TIMEOUT_MS) || 8000))
const MAX_IMAGE_BYTES = Math.min(8 * 1024 * 1024, Math.max(256 * 1024, Number(process.env.ARTWORK_VISUAL_MAX_IMAGE_BYTES) || 3 * 1024 * 1024))

function parsePositiveInt(raw) {
  const n = parseInt(String(raw), 10)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function decodeBase64Image(raw) {
  if (!raw || typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  const base64 = trimmed.includes('base64,') ? trimmed.split('base64,').pop() : trimmed
  try {
    const buffer = Buffer.from(base64, 'base64')
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null
    return buffer
  } catch {
    return null
  }
}

async function fetchImageBuffer(url) {
  if (!url || typeof url !== 'string') return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    const arrayBuffer = await res.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) return null
    return buffer
  } catch (err) {
    logger.warn('artworkVisualSearch fetch image failed', {
      url: url.slice(0, 120),
      err: err?.message || String(err),
    })
    return null
  } finally {
    clearTimeout(timer)
  }
}

function buildCandidateImageUrl(artworkType, artwork) {
  if (!artwork) return ''
  if (artworkType === 'original') {
    const image = artwork.image || artwork.image_url || ''
    return image ? buildArtworkMarkerLiveUrl(image) : ''
  }
  const image = artwork.image || artwork.image_url || ''
  return image ? String(image).trim() : ''
}

async function getOrComputeHash(cacheKey, imageUrl) {
  if (!imageUrl) return ''

  try {
    const cached = await redisClient.get(`${HASH_CACHE_PREFIX}${cacheKey}`)
    if (cached) return cached
  } catch (err) {
    logger.warn('artworkVisualSearch redis get failed', { err: err?.message || err })
  }

  const buffer = await fetchImageBuffer(imageUrl)
  if (!buffer) return ''

  const hash = await computeDifferenceHashFromBuffer(buffer)
  if (!hash) return ''

  try {
    await redisClient.set(`${HASH_CACHE_PREFIX}${cacheKey}`, hash, { EX: HASH_CACHE_TTL_SEC })
  } catch (err) {
    logger.warn('artworkVisualSearch redis set failed', { err: err?.message || err })
  }

  return hash
}

async function loadExhibitionCandidates(exhibitionId) {
  const [exhibitionRows] = await db.query(
    `SELECT id, title, status FROM ${EXHIBITIONS_TABLE} WHERE id = ? LIMIT 1`,
    [exhibitionId]
  )
  const exhibition = exhibitionRows?.[0]
  if (!exhibition) return null
  if (exhibition.status !== 'published') return { exhibition, candidates: [] }

  const [items] = await db.query(
    `
      SELECT id, artwork_type, artwork_id, sort_order
      FROM ${EXHIBITION_ITEMS_TABLE}
      WHERE exhibition_id = ?
      ORDER BY sort_order ASC, id ASC
    `,
    [exhibitionId]
  )

  const originalIds = []
  const digitalIds = []
  for (const item of items || []) {
    if (item.artwork_type === 'original') {
      const id = parsePositiveInt(item.artwork_id)
      if (id) originalIds.push(id)
    } else if (item.artwork_type === 'digital') {
      digitalIds.push(String(item.artwork_id))
    }
  }

  const originalMap = new Map()
  if (originalIds.length) {
    const [rows] = await db.query(
      `
        SELECT id, title, image
        FROM ${ORIGINAL_ARTWORKS_TABLE}
        WHERE id IN (${originalIds.map(() => '?').join(',')})
      `,
      originalIds
    )
    for (const row of rows || []) {
      originalMap.set(String(row.id), row)
    }
  }

  const digitalMap = new Map()
  if (digitalIds.length) {
    const [rows] = await db.query(
      `
        SELECT id, title, image_url AS image
        FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE}
        WHERE id IN (${digitalIds.map(() => '?').join(',')})
      `,
      digitalIds
    )
    for (const row of rows || []) {
      digitalMap.set(String(row.id), row)
    }
  }

  const candidates = []
  for (const item of items || []) {
    const artwork = item.artwork_type === 'original'
      ? originalMap.get(String(item.artwork_id))
      : digitalMap.get(String(item.artwork_id))
    const imageUrl = buildCandidateImageUrl(item.artwork_type, artwork)
    if (!artwork || !imageUrl) continue
    candidates.push({
      item_id: item.id,
      artwork_type: item.artwork_type,
      artwork_id: String(item.artwork_id),
      title: artwork.title || '未命名作品',
      image_url: imageUrl,
      cache_key: `${item.artwork_type}:${item.artwork_id}`,
    })
  }

  return { exhibition, candidates }
}

async function searchInCandidates(queryHash, candidates) {
  const scored = []

  for (const candidate of candidates) {
    const refHash = await getOrComputeHash(candidate.cache_key, candidate.image_url)
    if (!refHash) continue
    const distance = hammingDistance(queryHash, refHash)
    scored.push({
      ...candidate,
      distance,
      confidence: confidenceFromDistance(distance),
    })
  }

  scored.sort((a, b) => a.distance - b.distance)
  return scored
}

async function visualSearchByExhibition(exhibitionId, body) {
  const id = parsePositiveInt(exhibitionId)
  if (!id) {
    return { ok: false, status: 400, body: { error: '展览 ID 无效' } }
  }

  const imageBuffer = decodeBase64Image(body?.image_base64 || body?.image)
  if (!imageBuffer) {
    return { ok: false, status: 400, body: { error: '请提供有效的拍摄图片' } }
  }

  const loaded = await loadExhibitionCandidates(id)
  if (!loaded) {
    return { ok: false, status: 404, body: { error: '展览不存在' } }
  }

  const { exhibition, candidates } = loaded
  if (!candidates.length) {
    return {
      ok: true,
      status: 200,
      body: {
        matched: false,
        reason: 'no_candidates',
        message: '本展览暂无可识别作品',
        exhibition_id: exhibition.id,
        exhibition_title: exhibition.title,
      },
    }
  }

  const queryHash = await computeDifferenceHashFromBuffer(imageBuffer)
  if (!queryHash) {
    return { ok: false, status: 400, body: { error: '无法解析拍摄图片' } }
  }

  const scored = await searchInCandidates(queryHash, candidates)
  if (!scored.length) {
    return {
      ok: true,
      status: 200,
      body: {
        matched: false,
        reason: 'hash_unavailable',
        message: '暂无法加载作品图进行比对，请稍后重试',
        exhibition_id: exhibition.id,
        exhibition_title: exhibition.title,
      },
    }
  }

  const best = scored[0]
  const second = scored[1]
  if (best.distance > MATCH_THRESHOLD) {
    return {
      ok: true,
      status: 200,
      body: {
        matched: false,
        reason: 'no_match',
        message: '未在本展览中识别到匹配作品，请正对画作、避开反光后重试',
        exhibition_id: exhibition.id,
        exhibition_title: exhibition.title,
        threshold: MATCH_THRESHOLD,
        best_distance: best.distance,
      },
    }
  }

  if (second && second.distance - best.distance < AMBIGUOUS_GAP) {
    return {
      ok: true,
      status: 200,
      body: {
        matched: false,
        reason: 'ambiguous',
        message: '识别到多幅相似作品，请靠近单幅作品后重试',
        exhibition_id: exhibition.id,
        exhibition_title: exhibition.title,
        candidates: scored.slice(0, 3).map((row) => ({
          artwork_type: row.artwork_type,
          artwork_id: row.artwork_id,
          title: row.title,
          distance: row.distance,
          confidence: row.confidence,
        })),
      },
    }
  }

  const detailPath = best.artwork_type === 'digital'
    ? `/pages/digital/detail?id=${best.artwork_id}`
    : `/pages/artwork/detail?id=${best.artwork_id}`

  return {
    ok: true,
    status: 200,
    body: {
      matched: true,
      exhibition_id: exhibition.id,
      exhibition_title: exhibition.title,
      artwork_type: best.artwork_type,
      artwork_id: best.artwork_id,
      title: best.title,
      confidence: best.confidence,
      distance: best.distance,
      threshold: MATCH_THRESHOLD,
      detail_path: detailPath,
    },
  }
}

module.exports = {
  visualSearchByExhibition,
  MATCH_THRESHOLD,
}
