const logger = require('./logger')

const BASE_URL = String(process.env.ART_VISION_BASE_URL || '').replace(/\/$/, '')
const INTERNAL_TOKEN = String(process.env.ART_VISION_INTERNAL_TOKEN || '').trim()
const TIMEOUT_MS = Math.min(60000, Math.max(3000, Number(process.env.ART_VISION_TIMEOUT_MS) || 25000))

function isArtVisionEnabled() {
  if (process.env.ART_VISION_ENABLED !== 'true') return false
  if (!BASE_URL || !INTERNAL_TOKEN) return false
  return true
}

async function artVisionRequest(method, path, body) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    let data = {}
    try {
      data = await res.json()
    } catch {
      data = {}
    }
    return { ok: res.ok, status: res.status, body: data }
  } catch (err) {
    logger.warn('artVisionClient request failed', {
      path,
      err: err?.message || String(err),
    })
    return { ok: false, status: 0, body: { error: 'request_failed' } }
  } finally {
    clearTimeout(timer)
  }
}

async function indexExhibition(exhibitionId, payload) {
  if (!isArtVisionEnabled()) return { ok: false, skipped: true }
  const id = parseInt(String(exhibitionId), 10)
  if (!Number.isFinite(id) || id <= 0) return { ok: false, status: 400, body: { error: 'invalid_id' } }
  return artVisionRequest('POST', `/internal/exhibitions/${id}/index`, payload)
}

async function searchExhibition(exhibitionId, imageBase64) {
  if (!isArtVisionEnabled()) return { ok: false, skipped: true }
  const id = parseInt(String(exhibitionId), 10)
  if (!Number.isFinite(id) || id <= 0) return { ok: false, status: 400, body: { error: 'invalid_id' } }
  return artVisionRequest('POST', `/internal/exhibitions/${id}/search`, {
    image_base64: imageBase64,
  })
}

async function getHealth() {
  if (!BASE_URL) return { ok: false, skipped: true }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.min(TIMEOUT_MS, 5000))
  try {
    const res = await fetch(`${BASE_URL}/internal/health`, { signal: controller.signal })
    const body = await res.json().catch(() => ({}))
    return { ok: res.ok, status: res.status, body }
  } catch (err) {
    return { ok: false, status: 0, body: { error: err?.message || String(err) } }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  isArtVisionEnabled,
  indexExhibition,
  searchExhibition,
  getHealth,
}
