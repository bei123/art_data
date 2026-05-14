/**
 * 从 WMS（RB/WEB HTTP）同步原作主档：名称、艺术家、年代、价格、尺寸、作品类型。
 * 依赖表字段：original_artworks.wms_record_id、wms_last_modified（见 sql/migrations/003）
 */
const db = require('../db')
const logger = require('../utils/logger')
const { OSS_PUBLIC_ORIGIN, validatePublicImageUrl } = require('../config/publicEnv')
const {
  wmsUserLoginFromEnv,
  wmsProductDataList,
  wmsProductViewModel,
  WMS_PRODUCT_DATA_LIST_DEFAULT_BODY,
} = require('../utils/wmsHttpClient')
const { WMS_SYNC_PLACEHOLDER_IMAGE } = require('../config/wmsHttp')
const { resolveFinalArtistId, invalidateArtworksPublicCaches } = require('./artworksService')
const { invalidateArtistsListCache } = require('./artistsService')

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body }
}

function placeholderImageUrl() {
  const fromEnv = String(WMS_SYNC_PLACEHOLDER_IMAGE || '').trim()
  if (fromEnv && validatePublicImageUrl(fromEnv)) return fromEnv
  const ossFallback = `${OSS_PUBLIC_ORIGIN}/wms-sync-placeholder.png`
  if (validatePublicImageUrl(ossFallback)) return ossFallback
  return '/uploads/wms-sync-placeholder.png'
}

function findElement(elements, field) {
  if (!Array.isArray(elements)) return null
  return elements.find((e) => e && e.field === field) || null
}

function elementTextValue(el) {
  if (!el || el.value === undefined || el.value === null) return ''
  if (typeof el.value === 'object') return ''
  return String(el.value).trim()
}

/** 与 REBUILD 列表单元格类似：REFERENCE 常渲染为 text / html，详情里可能只有 id */
function stripHtmlToText(html) {
  const s = String(html ?? '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return s
}

/** 从字段 options 里用 id 解析展示名（REFERENCE / 分类 等） */
function textFromElementOptions(el) {
  if (!el || !Array.isArray(el.options) || el.options.length === 0) return ''
  const raw = el.value
  if (raw === undefined || raw === null) return ''
  const key =
    typeof raw === 'object' && raw !== null && raw.id !== undefined && raw.id !== null
      ? String(raw.id)
      : String(raw)
  const hit = el.options.find((o) => o != null && (String(o.id) === key || o.id === raw))
  if (!hit) return ''
  if (typeof hit.text === 'string' && hit.text.trim()) return String(hit.text).trim()
  if (typeof hit.label === 'string' && hit.label.trim()) return String(hit.label).trim()
  return ''
}

/** 列表行去掉末尾「记录 id」元格，得到与 fields 对齐的数据格 */
function dataCellsFromListRow(row) {
  if (!Array.isArray(row) || row.length === 0) return []
  const last = row[row.length - 1]
  if (last && typeof last === 'object' && last.entity === 'Product' && last.id) return row.slice(0, -1)
  return row
}

function stringifyListCellArtist(cell) {
  if (cell == null || cell === '') return ''
  if (typeof cell === 'string' || typeof cell === 'number') return String(cell).trim()
  if (typeof cell !== 'object') return ''
  if (typeof cell.text === 'string' && cell.text.trim()) return String(cell.text).trim()
  if (typeof cell.html === 'string' && cell.html.trim()) {
    const plain = stripHtmlToText(cell.html)
    if (plain) return plain
  }
  const v = cell.value
  if (v != null && typeof v !== 'object') {
    const s = String(v).trim()
    if (!s) return ''
    if (/^\d+-[0-9a-f]{8,}$/i.test(s)) return ''
    return s
  }
  if (v != null && typeof v === 'object') {
    if (typeof v.name === 'string' && v.name.trim()) return String(v.name).trim()
    if (typeof v.text === 'string' && v.text.trim()) return String(v.text).trim()
    if (typeof v.label === 'string' && v.label.trim()) return String(v.label).trim()
  }
  if (typeof cell.label === 'string' && cell.label.trim()) return String(cell.label).trim()
  return ''
}

function extractArtistHintFromDataListRow(row, fields) {
  if (!Array.isArray(fields) || fields.length === 0) return ''
  const idx = fields.indexOf('yishujia31')
  if (idx < 0) return ''
  const cells = dataCellsFromListRow(row)
  if (idx >= cells.length) return ''
  return stringifyListCellArtist(cells[idx])
}

/** WMS 艺术家：用 value（如 TEXT「韦少东」）；勿用 el.label——那是字段标题「艺术家」，不是人名 */
function elementArtistDisplayName(el) {
  if (!el || el.value === undefined || el.value === null) return ''

  const fromOpts = textFromElementOptions(el)
  if (fromOpts) return fromOpts

  const v = el.value
  if (typeof v === 'string' || typeof v === 'number') return String(v).trim()
  if (typeof v === 'object' && v !== null) {
    if (typeof v.name === 'string' && v.name.trim()) return String(v.name).trim()
    if (typeof v.text === 'string' && v.text.trim()) return String(v.text).trim()
    if (typeof v.label === 'string' && v.label.trim()) return String(v.label).trim()
    if (v.id !== undefined && v.id !== null) {
      const idStr = String(v.id)
      const hit = Array.isArray(el.options)
        ? el.options.find((o) => o != null && String(o.id) === idStr)
        : null
      if (hit) {
        if (typeof hit.text === 'string' && hit.text.trim()) return String(hit.text).trim()
        if (typeof hit.label === 'string' && hit.label.trim()) return String(hit.label).trim()
      }
    }
  }
  return elementTextValue(el)
}

function picklistDisplayText(el) {
  if (!el || el.type !== 'PICKLIST') return ''
  const vid = el.value
  const opts = el.options || []
  if (!vid || !Array.isArray(opts)) return ''
  const hit = opts.find((o) => o && o.id === vid)
  return hit && hit.text ? String(hit.text).trim() : ''
}

function parseMoneyToNumber(raw) {
  if (raw === undefined || raw === null || raw === '') return null
  const n = parseFloat(String(raw).replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return n
}

function buildCollectionSize(elements) {
  const changEl = findElement(elements, 'chang')
  const kuanEl = findElement(elements, 'kuan')
  const c = changEl ? parseMoneyToNumber(changEl.value) : null
  const k = kuanEl ? parseMoneyToNumber(kuanEl.value) : null
  if (c != null && k != null) return `${c}×${k}cm`
  if (c != null) return `${c}cm`
  if (k != null) return `${k}cm`
  return ''
}

/**
 * @param {object[]} elements view-model elements
 * @param {{ row?: unknown[], fields?: string[] } | null | undefined} listHint 同次列表接口的行与 fields，用于艺术家展示名后备
 */
function mapElementsToSyncPayload(elements, listHint) {
  const title = elementTextValue(findElement(elements, 'ProductName'))
  let artistName = elementArtistDisplayName(findElement(elements, 'yishujia31'))
  if (!artistName && listHint && Array.isArray(listHint.row) && Array.isArray(listHint.fields)) {
    artistName = extractArtistHintFromDataListRow(listHint.row, listHint.fields)
  }
  const yearRaw = elementTextValue(findElement(elements, 'chuangzuoniandai'))
  const year = yearRaw || null
  const priceNum = parseMoneyToNumber(elementTextValue(findElement(elements, 'UnitPrice')))
  const collection_size = buildCollectionSize(elements)
  const zuopinleixing = findElement(elements, 'zuopinleixing')
  const collection_material = picklistDisplayText(zuopinleixing)
  return {
    title,
    artistName,
    year,
    price: priceNum,
    collection_size,
    collection_material,
  }
}

function recordIdFromListRow(row) {
  if (!Array.isArray(row) || row.length === 0) return null
  const last = row[row.length - 1]
  if (!last || typeof last !== 'object') return null
  if (last.entity === 'Product' && last.id) return String(last.id)
  return null
}

/**
 * @param {string} cookie
 * @param {string} recordId
 * @param {{ row?: unknown[], fields?: string[] } | null | undefined} listHint 列表行里艺术家列常有可读文本
 * @returns {Promise<{ ok: boolean, status: string, artworkId?: number, error?: string }>}
 */
async function upsertOneProductFromWms(cookie, recordId, listHint) {
  const res = await wmsProductViewModel({ cookie, id: recordId })
  if (res.status < 200 || res.status >= 300) {
    return { ok: false, status: 'http_error', error: `HTTP ${res.status}` }
  }
  const root = res.data
  if (!root || root.error_code !== 0) {
    return {
      ok: false,
      status: 'wms_error',
      error: (root && root.error_msg) || 'WMS 返回异常',
    }
  }
  const d = root.data
  if (!d || !Array.isArray(d.elements)) {
    return { ok: false, status: 'bad_payload', error: '缺少 elements' }
  }
  const lastModified =
    d.lastModified !== undefined && d.lastModified !== null
      ? Number(d.lastModified)
      : null
  const payload = mapElementsToSyncPayload(d.elements, listHint)
  if (!payload.title) {
    return { ok: false, status: 'skip', error: '无作品名称' }
  }
  if (!payload.artistName) {
    return { ok: false, status: 'skip', error: '无艺术家' }
  }
  const artistId = await resolveFinalArtistId(null, payload.artistName)
  if (!artistId) {
    return { ok: false, status: 'skip', error: '无法解析艺术家' }
  }

  const [rows] = await db.query(
    'SELECT id, wms_last_modified FROM original_artworks WHERE wms_record_id = ? LIMIT 1',
    [recordId]
  )
  const existing = rows && rows[0] ? rows[0] : null

  if (
    existing &&
    lastModified != null &&
    existing.wms_last_modified != null &&
    Number(existing.wms_last_modified) === lastModified
  ) {
    return { ok: true, status: 'skipped_unchanged', artworkId: existing.id }
  }

  const price = payload.price != null ? payload.price : 0
  const collection_size = payload.collection_size || null
  const collection_material = payload.collection_material || null

  if (existing) {
    await db.query(
      `UPDATE original_artworks SET
        title = ?, artist_id = ?, year = ?, price = ?, original_price = ?,
        collection_size = ?, collection_material = ?, wms_last_modified = ?
      WHERE id = ?`,
      [
        payload.title,
        artistId,
        payload.year,
        price,
        price,
        collection_size,
        collection_material,
        lastModified,
        existing.id,
      ]
    )
    return { ok: true, status: 'updated', artworkId: existing.id }
  }

  const image = placeholderImageUrl()
  const [ins] = await db.query(
    `INSERT INTO original_artworks (
      title, image, artist_id, year, description, long_description,
      background, features, collection_location, collection_number,
      collection_size, collection_material, price, original_price, discount_price,
      stock, sales, is_on_sale, wms_record_id, wms_last_modified
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      payload.title,
      image,
      artistId,
      payload.year,
      '',
      '',
      '',
      '',
      null,
      null,
      collection_size,
      collection_material,
      price,
      price,
      null,
      0,
      0,
      0,
      recordId,
      lastModified,
    ]
  )
  const artworkId = ins.insertId
  return { ok: true, status: 'inserted', artworkId }
}

async function runPool(items, concurrency, worker) {
  const out = []
  const n = Math.max(1, Math.min(10, concurrency || 3))
  for (let i = 0; i < items.length; i += n) {
    const chunk = items.slice(i, i + n)
    const part = await Promise.all(chunk.map((item) => worker(item)))
    out.push(...part)
  }
  return out
}

/**
 * 管理端触发：登录 WMS → 分页拉列表 → 并发拉详情并 upsert
 * @param {{ maxPages?: number, pageSize?: number, detailConcurrency?: number }} body
 */
async function syncFromWmsAdmin(body) {
  const maxPages = Math.min(500, Math.max(1, parseInt(String(body?.maxPages ?? 20), 10) || 20))
  const pageSize = Math.min(100, Math.max(1, parseInt(String(body?.pageSize ?? 20), 10) || 20))
  const detailConcurrency = Math.min(10, Math.max(1, parseInt(String(body?.detailConcurrency ?? 3), 10) || 3))

  const stats = {
    pages: 0,
    listRows: 0,
    inserted: 0,
    updated: 0,
    skipped_unchanged: 0,
    skipped_skip: 0,
    errors: [],
  }
  const touchedArtworkIds = []

  try {
    const { sessionCookie, response: loginRes } = await wmsUserLoginFromEnv()
    if (loginRes.status < 200 || loginRes.status >= 300) {
      return adminResult(502, { error: 'WMS 登录 HTTP 失败', status: loginRes.status })
    }
    const loginBody = loginRes.data
    if (!loginBody || loginBody.error_code !== 0) {
      const wmsMsg = (loginBody && loginBody.error_msg) || '未知'
      const baseHint =
        '请核对 .env 的 WMS_HTTP_USER、WMS_HTTP_PASSWORD；密码含 # 等请用双引号包裹整段，或改用 WMS_HTTP_PASSWORD_B64（UTF-8 明文 base64）；账号须与网页登录框一致。'
      const vcodeHint =
        wmsMsg === 'VCODE'
          ? ' 若站点开启图形验证码：在 .env 中设置 WMS_HTTP_VCODE（与登录页图片一致），或设置 WMS_HTTP_COOKIE（从已打开 /user/login 的浏览器复制整段 Cookie，须含 RBSESSION）；服务端已自动 GET /user/login 预热会话。'
          : ''
      return adminResult(502, {
        error: `WMS 登录失败：${wmsMsg}。${baseHint}${vcodeHint}`,
        error_msg: loginBody && loginBody.error_msg,
      })
    }
    const cookie = sessionCookie || ''
    if (!cookie) {
      return adminResult(502, { error: 'WMS 登录未返回 RBSESSION，请检查账号密码与站点' })
    }

    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      const listRequestBody = {
        ...WMS_PRODUCT_DATA_LIST_DEFAULT_BODY,
        pageNo,
        pageSize,
      }
      const listRes = await wmsProductDataList({
        cookie,
        body: listRequestBody,
      })
      if (listRes.status < 200 || listRes.status >= 300) {
        stats.errors.push({ page: pageNo, error: `列表 HTTP ${listRes.status}` })
        break
      }
      const root = listRes.data
      if (!root || root.error_code !== 0) {
        stats.errors.push({
          page: pageNo,
          error: (root && root.error_msg) || '列表业务错误',
        })
        break
      }
      const rows = root.data && root.data.data
      if (!Array.isArray(rows) || rows.length === 0) break

      stats.pages += 1
      stats.listRows += rows.length

      const listFields = Array.isArray(listRequestBody.fields) && listRequestBody.fields.length
        ? listRequestBody.fields
        : WMS_PRODUCT_DATA_LIST_DEFAULT_BODY.fields

      const idToListRow = new Map()
      const ids = []
      for (const row of rows) {
        const rid = recordIdFromListRow(row)
        if (rid) {
          ids.push(rid)
          idToListRow.set(rid, row)
        }
      }

      const results = await runPool(ids, detailConcurrency, async (recordId) => {
        try {
          const row = idToListRow.get(recordId)
          const listHint = row ? { row, fields: listFields } : null
          const r = await upsertOneProductFromWms(cookie, recordId, listHint)
          return { recordId, ...r }
        } catch (e) {
          return { recordId, ok: false, status: 'exception', error: e.message }
        }
      })

      for (const r of results) {
        if (!r.ok) {
          if (r.status === 'skip') stats.skipped_skip += 1
          else stats.errors.push({ id: r.recordId, error: r.error || r.status })
          continue
        }
        if (r.status === 'skipped_unchanged') stats.skipped_unchanged += 1
        else if (r.status === 'inserted') {
          stats.inserted += 1
          if (r.artworkId) touchedArtworkIds.push(r.artworkId)
        } else if (r.status === 'updated') {
          stats.updated += 1
          if (r.artworkId) touchedArtworkIds.push(r.artworkId)
        }
      }

      if (rows.length < pageSize) break
    }

    if (touchedArtworkIds.length > 0) {
      await invalidateArtworksPublicCaches({ artworkDetailIds: touchedArtworkIds })
    } else {
      await invalidateArtworksPublicCaches({ listOnly: true })
    }
    await invalidateArtistsListCache()

    return adminResult(200, { message: '同步完成', stats })
  } catch (e) {
    if (e.code === 'WMS_HTTP_NOT_CONFIGURED' || e.code === 'WMS_HTTP_BAD_REQUEST') {
      return adminResult(400, { error: e.message })
    }
    logger.error('syncFromWmsAdmin_failed', { err: e })
    return adminResult(500, { error: e.message || '同步失败' })
  }
}

module.exports = {
  syncFromWmsAdmin,
  upsertOneProductFromWms,
  mapElementsToSyncPayload,
}
