const logger = require('./logger')
const { isArtVisionEnabled, indexExhibition } = require('./artVisionClient')

const pendingTimers = new Map()
const DEBOUNCE_MS = Math.max(500, Number(process.env.ART_VISION_INDEX_DEBOUNCE_MS) || 3000)

function scheduleExhibitionVisionIndexSync(exhibitionId, loadCandidates) {
  if (!isArtVisionEnabled()) return
  if (typeof loadCandidates !== 'function') return

  const id = parseInt(String(exhibitionId), 10)
  if (!Number.isFinite(id) || id <= 0) return

  if (pendingTimers.has(id)) clearTimeout(pendingTimers.get(id))

  const timer = setTimeout(() => {
    pendingTimers.delete(id)
    syncExhibitionVisionIndex(id, loadCandidates).catch((err) => {
      logger.warn('exhibition vision index sync failed', {
        exhibition_id: id,
        err: err?.message || String(err),
      })
    })
  }, DEBOUNCE_MS)

  pendingTimers.set(id, timer)
}

async function syncExhibitionVisionIndex(exhibitionId, loadCandidates) {
  const loaded = await loadCandidates(exhibitionId)
  if (!loaded) return { ok: false, reason: 'not_found' }

  const { exhibition, candidates } = loaded
  const items = (candidates || []).map((row) => ({
    item_id: row.item_id,
    artwork_type: row.artwork_type,
    artwork_id: row.artwork_id,
    title: row.title,
    image_url: row.image_url,
  }))

  const result = await indexExhibition(exhibitionId, {
    exhibition_title: exhibition?.title || '',
    items,
  })

  if (!result.ok && !result.skipped) {
    logger.warn('exhibition vision index request failed', {
      exhibition_id: exhibitionId,
      status: result.status,
      error: result.body?.error,
    })
    return { ok: false, status: result.status, body: result.body }
  }

  if (result.ok) {
    logger.info('exhibition vision index synced', {
      exhibition_id: exhibitionId,
      indexed_count: result.body?.indexed_count,
      candidate_count: result.body?.candidate_count,
    })
  }

  return { ok: true, body: result.body }
}

async function syncAllPublishedExhibitionVisionIndexes(deps) {
  if (!isArtVisionEnabled()) return { synced: 0, total: 0, skipped: true }

  const listPublishedExhibitionIds = deps?.listPublishedExhibitionIds
  const loadCandidates = deps?.loadCandidates
  if (typeof listPublishedExhibitionIds !== 'function' || typeof loadCandidates !== 'function') {
    return { synced: 0, total: 0, error: 'invalid_deps' }
  }

  const ids = await listPublishedExhibitionIds()
  let synced = 0
  for (const exhibitionId of ids) {
    try {
      const result = await syncExhibitionVisionIndex(exhibitionId, loadCandidates)
      if (result.ok) synced += 1
    } catch (err) {
      logger.warn('exhibition vision index sync failed', {
        exhibition_id: exhibitionId,
        err: err?.message || String(err),
      })
    }
  }

  logger.info('exhibition vision index bootstrap finished', {
    synced,
    total: ids.length,
  })
  return { synced, total: ids.length }
}

function startExhibitionVisionIndexBootstrap(deps) {
  if (!isArtVisionEnabled()) return
  if (process.env.ART_VISION_INDEX_SYNC_ON_STARTUP === 'false') return

  const delayMs = Math.max(
    3000,
    Number(process.env.ART_VISION_INDEX_STARTUP_DELAY_MS) || 15000
  )

  setTimeout(() => {
    syncAllPublishedExhibitionVisionIndexes(deps).catch((err) => {
      logger.warn('exhibition vision index bootstrap failed', {
        err: err?.message || String(err),
      })
    })
  }, delayMs)

  logger.info('exhibition vision index bootstrap scheduled', { delay_ms: delayMs })
}

module.exports = {
  scheduleExhibitionVisionIndexSync,
  syncExhibitionVisionIndex,
  syncAllPublishedExhibitionVisionIndexes,
  startExhibitionVisionIndexBootstrap,
}
