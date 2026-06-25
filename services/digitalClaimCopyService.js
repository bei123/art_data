const db = require('../db')
const logger = require('../utils/logger')
const redisClient = require('../utils/redisClient')
const {
  DEFAULT_DIGITAL_CLAIM_COPY,
  ensureDigitalClaimCopyTable,
} = require('../utils/digitalClaimCopySchema')
const {
  normalizeBoolean,
  normalizeBlocks,
  resolveListBlocks,
  resolveSheetBlocks,
  validateBlocksInput,
  blocksFromLegacyIntroSteps,
} = require('../utils/digitalClaimCopyBlocks')

const REDIS_DIGITAL_CLAIM_COPY_KEY = 'digital_claim_copy:public'
const CACHE_TTL_SEC = 300

function isForceHidden() {
  const raw = process.env.DIGITAL_CLAIM_COPY_FORCE_HIDDEN
  if (raw == null || raw === '') return false
  const normalized = String(raw).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function mapAdminRow(row) {
  if (!row) return { ...DEFAULT_DIGITAL_CLAIM_COPY }
  const listBlocksRaw = parseJsonMaybe(row.list_blocks)
  const sheetBlocksRaw = parseJsonMaybe(row.sheet_blocks)
  return {
    list_visible: normalizeBoolean(row.list_visible, false),
    sheet_guide_visible: normalizeBoolean(row.sheet_guide_visible, false),
    guide_title: String(row.guide_title || '').trim(),
    list_blocks: listBlocksRaw.length
      ? normalizeBlocks(listBlocksRaw, { forAdmin: true })
      : blocksFromLegacyIntroSteps(row.guide_intro, row.guide_steps),
    sheet_blocks: sheetBlocksRaw.length
      ? normalizeBlocks(sheetBlocksRaw, { forAdmin: true })
      : (() => {
          const legacy = blocksFromLegacyIntroSteps(row.guide_intro, row.guide_steps)
          const tip = String(row.sheet_tip || '').trim()
          if (tip) legacy.push({ type: 'text', content: tip })
          return legacy
        })(),
    updated_at: row.updated_at || null,
  }
}

function parseJsonMaybe(raw) {
  if (Array.isArray(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

function mapRow(row) {
  if (!row) return { ...DEFAULT_DIGITAL_CLAIM_COPY }
  return {
    list_visible: normalizeBoolean(row.list_visible, false),
    sheet_guide_visible: normalizeBoolean(row.sheet_guide_visible, false),
    guide_title: String(row.guide_title || '').trim(),
    list_blocks: resolveListBlocks(row),
    sheet_blocks: resolveSheetBlocks(row),
    updated_at: row.updated_at || null,
  }
}

function applyForceHidden(copy) {
  if (!isForceHidden()) return copy
  return {
    ...copy,
    list_visible: false,
    sheet_guide_visible: false,
  }
}

function validateUpdateInput(body) {
  if (!body || typeof body !== 'object') {
    return { error: '请求体无效' }
  }

  const guideTitle = String(body.guide_title ?? '').trim()
  if (guideTitle.length > 64) {
    return { error: '说明标题不能超过 64 个字符' }
  }

  const listBlocksResult = validateBlocksInput(body.list_blocks, '资产页内容')
  if (listBlocksResult.error) return listBlocksResult

  const sheetBlocksResult = validateBlocksInput(body.sheet_blocks, '领取码弹层内容')
  if (sheetBlocksResult.error) return sheetBlocksResult

  return {
    data: {
      list_visible: normalizeBoolean(body.list_visible, false),
      sheet_guide_visible: normalizeBoolean(body.sheet_guide_visible, false),
      guide_title: guideTitle,
      list_blocks: listBlocksResult.blocks,
      sheet_blocks: sheetBlocksResult.blocks,
    },
  }
}

async function fetchRow() {
  await ensureDigitalClaimCopyTable()
  const [rows] = await db.query(
    `SELECT list_visible, sheet_guide_visible, guide_title, guide_intro, guide_steps, sheet_tip,
            list_blocks, sheet_blocks, updated_at
     FROM digital_claim_copy
     WHERE id = 1
     LIMIT 1`
  )
  return rows[0] || null
}

async function getPublicDigitalClaimCopy() {
  try {
    const cached = await redisClient.get(REDIS_DIGITAL_CLAIM_COPY_KEY)
    if (cached) {
      return applyForceHidden(JSON.parse(cached))
    }
  } catch (err) {
    logger.warn('digital claim copy cache read failed', { err: err.message })
  }

  const row = await fetchRow()
  const copy = mapRow(row)
  const publicCopy = applyForceHidden(copy)

  try {
    await redisClient.setEx(REDIS_DIGITAL_CLAIM_COPY_KEY, CACHE_TTL_SEC, JSON.stringify(publicCopy))
  } catch (err) {
    logger.warn('digital claim copy cache write failed', { err: err.message })
  }

  return publicCopy
}

async function getAdminDigitalClaimCopy() {
  const row = await fetchRow()
  return {
    ...mapAdminRow(row),
    force_hidden: isForceHidden(),
  }
}

async function updateDigitalClaimCopy(body) {
  const validated = validateUpdateInput(body)
  if (validated.error) {
    return { ok: false, status: 400, body: { error: validated.error } }
  }

  const payload = validated.data
  await ensureDigitalClaimCopyTable()

  const [existing] = await db.query('SELECT id FROM digital_claim_copy WHERE id = 1 LIMIT 1')
  if (existing.length) {
    await db.query(
      `UPDATE digital_claim_copy
       SET list_visible = ?, sheet_guide_visible = ?, guide_title = ?, list_blocks = ?, sheet_blocks = ?, updated_at = NOW()
       WHERE id = 1`,
      [
        payload.list_visible ? 1 : 0,
        payload.sheet_guide_visible ? 1 : 0,
        payload.guide_title,
        JSON.stringify(payload.list_blocks),
        JSON.stringify(payload.sheet_blocks),
      ]
    )
  } else {
    await db.query(
      `INSERT INTO digital_claim_copy
        (id, list_visible, sheet_guide_visible, guide_title, list_blocks, sheet_blocks)
       VALUES (1, ?, ?, ?, ?, ?)`,
      [
        payload.list_visible ? 1 : 0,
        payload.sheet_guide_visible ? 1 : 0,
        payload.guide_title,
        JSON.stringify(payload.list_blocks),
        JSON.stringify(payload.sheet_blocks),
      ]
    )
  }

  try {
    await redisClient.del(REDIS_DIGITAL_CLAIM_COPY_KEY)
  } catch (err) {
    logger.warn('digital claim copy cache clear failed', { err: err.message })
  }

  const updated = await getAdminDigitalClaimCopy()
  return {
    ok: true,
    status: 200,
    body: {
      message: '领取说明已更新',
      data: updated,
    },
  }
}

module.exports = {
  DEFAULT_DIGITAL_CLAIM_COPY,
  isForceHidden,
  mapRow,
  applyForceHidden,
  getPublicDigitalClaimCopy,
  getAdminDigitalClaimCopy,
  updateDigitalClaimCopy,
}
