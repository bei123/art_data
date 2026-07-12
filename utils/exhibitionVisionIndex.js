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
  if (!loaded) return

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
    return
  }

  if (result.ok) {
    logger.info('exhibition vision index synced', {
      exhibition_id: exhibitionId,
      indexed_count: result.body?.indexed_count,
      candidate_count: result.body?.candidate_count,
    })
  }
}

module.exports = {
  scheduleExhibitionVisionIndexSync,
  syncExhibitionVisionIndex,
}
