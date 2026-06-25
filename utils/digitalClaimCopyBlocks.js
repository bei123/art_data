const { PUBLIC_API_BASE_URL, validatePublicImageUrl } = require('../config/publicEnv')

const BLOCK_TYPES = new Set(['text', 'image', 'link'])
const MAX_BLOCKS = 20
const MAX_TEXT_LEN = 1000
const MAX_LINK_LABEL_LEN = 64
const MAX_URL_LEN = 512
const MAX_ALT_LEN = 120

function normalizeBoolean(value, fallback = false) {
  if (value == null) return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value === 1
  const normalized = String(value).trim().toLowerCase()
  return normalized === '1' || normalized === 'true' || normalized === 'yes'
}

function parseJsonArray(raw) {
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

function resolvePublicAssetUrl(url) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/uploads/')) {
    return `${PUBLIC_API_BASE_URL}${trimmed}`
  }
  if (validatePublicImageUrl(trimmed)) return trimmed
  return ''
}

function isSafeHttpsUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim())
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function normalizeTextBlock(raw) {
  const content = String(raw?.content ?? raw?.text ?? '').trim()
  if (!content) return null
  return {
    type: 'text',
    content: content.slice(0, MAX_TEXT_LEN),
  }
}

function normalizeImageBlock(raw) {
  const url = resolvePublicAssetUrl(raw?.url || raw?.image_url || '')
  if (!url) return null
  const alt = String(raw?.alt || '').trim().slice(0, MAX_ALT_LEN)
  return {
    type: 'image',
    url,
    alt,
  }
}

function normalizeLinkBlock(raw) {
  const url = String(raw?.url || '').trim().slice(0, MAX_URL_LEN)
  const label = String(raw?.label || raw?.text || '').trim().slice(0, MAX_LINK_LABEL_LEN)
  if (!url || !label || !isSafeHttpsUrl(url)) return null
  return {
    type: 'link',
    label,
    url,
  }
}

function normalizeBlock(raw) {
  if (!raw || typeof raw !== 'object') return null
  const type = String(raw.type || '').trim().toLowerCase()
  if (!BLOCK_TYPES.has(type)) return null
  if (type === 'text') return normalizeTextBlock(raw)
  if (type === 'image') return normalizeImageBlock(raw)
  if (type === 'link') return normalizeLinkBlock(raw)
  return null
}

function normalizeBlocks(raw, { forAdmin = false } = {}) {
  const items = parseJsonArray(raw)
  const blocks = []
  for (const item of items) {
    const block = normalizeBlock(item)
    if (!block) continue
    if (forAdmin && block.type === 'image') {
      blocks.push({
        type: 'image',
        url: String(item?.url || item?.image_url || '').trim(),
        alt: block.alt || '',
      })
      continue
    }
    blocks.push(block)
    if (blocks.length >= MAX_BLOCKS) break
  }
  return blocks
}

function blocksFromLegacyIntroSteps(intro, steps) {
  const blocks = []
  const introText = String(intro || '').trim()
  if (introText) blocks.push({ type: 'text', content: introText })
  const stepItems = Array.isArray(steps) ? steps : parseJsonArray(steps)
  for (const step of stepItems) {
    const content = String(step || '').trim()
    if (content) blocks.push({ type: 'text', content })
  }
  return blocks.slice(0, MAX_BLOCKS)
}

function resolveListBlocks(row) {
  const direct = normalizeBlocks(row?.list_blocks)
  if (direct.length) return direct
  return blocksFromLegacyIntroSteps(row?.guide_intro, row?.guide_steps)
}

function resolveSheetBlocks(row) {
  const direct = normalizeBlocks(row?.sheet_blocks)
  if (direct.length) return direct
  const legacy = blocksFromLegacyIntroSteps(row?.guide_intro, row?.guide_steps)
  const tip = String(row?.sheet_tip || '').trim()
  if (tip) legacy.push({ type: 'text', content: tip })
  return legacy.slice(0, MAX_BLOCKS)
}

function hasRenderableBlocks(blocks) {
  return Array.isArray(blocks) && blocks.length > 0
}

function validateBlocksInput(raw, label) {
  const items = parseJsonArray(raw)
  if (items.length > MAX_BLOCKS) {
    return { error: `${label}不能超过 ${MAX_BLOCKS} 个内容块` }
  }
  for (const item of items) {
    const type = String(item?.type || '').trim().toLowerCase()
    if (!BLOCK_TYPES.has(type)) {
      return { error: `${label}存在无效的内容块类型` }
    }
    if (type === 'text') {
      const content = String(item?.content ?? item?.text ?? '').trim()
      if (!content) return { error: `${label}的文字块不能为空` }
      if (content.length > MAX_TEXT_LEN) return { error: `${label}的文字块不能超过 ${MAX_TEXT_LEN} 个字符` }
    }
    if (type === 'image') {
      const url = String(item?.url || item?.image_url || '').trim()
      if (!url) return { error: `${label}的图片块必须填写图片地址` }
      if (!url.startsWith('/uploads/') && !validatePublicImageUrl(url) && !isSafeHttpsUrl(url)) {
        return { error: `${label}的图片地址无效` }
      }
    }
    if (type === 'link') {
      const url = String(item?.url || '').trim()
      const linkLabel = String(item?.label || item?.text || '').trim()
      if (!linkLabel) return { error: `${label}的链接块必须填写显示文字` }
      if (!url || !isSafeHttpsUrl(url)) return { error: `${label}的链接必须是有效的 https 地址` }
      if (linkLabel.length > MAX_LINK_LABEL_LEN) {
        return { error: `${label}的链接文字不能超过 ${MAX_LINK_LABEL_LEN} 个字符` }
      }
    }
  }
  return { blocks: normalizeBlocks(items, { forAdmin: true }) }
}

module.exports = {
  BLOCK_TYPES,
  MAX_BLOCKS,
  normalizeBoolean,
  normalizeBlocks,
  normalizeBlock,
  blocksFromLegacyIntroSteps,
  resolveListBlocks,
  resolveSheetBlocks,
  hasRenderableBlocks,
  validateBlocksInput,
  resolvePublicAssetUrl,
  isSafeHttpsUrl,
}
