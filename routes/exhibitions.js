const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken, checkRole } = require('../auth');
const { processObjectImages } = require('../utils/image');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';
const EXHIBITIONS_TABLE = 'exhibitions';
const EXHIBITION_ITEMS_TABLE = 'exhibition_items';
const EXHIBITION_ITEM_ARTISTS_TABLE = 'exhibition_item_artists';

let schemaReady = false;

function validateImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('/uploads/') || url.startsWith('https://wx.oss.2000gallery.art/')) return true;
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'wx.oss.2000gallery.art';
  } catch (e) {
    return false;
  }
}

function normalizeArtworkType(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (['original', 'original_artwork', 'original_artworks'].includes(lower)) return 'original';
  if (['digital', 'digital_artwork', 'digital_artworks'].includes(lower)) return 'digital';
  return null;
}

function parsePositiveInt(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

function parseDigitalArtworkId(raw) {
  // digital_artworks_external.id 是 VARCHAR(64)，通常是数字字符串
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  if (s.length > 64) return null;
  return s;
}

function uniqPreserveOrder(arr) {
  const seen = new Set();
  const out = [];
  for (const v of arr) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

async function ensureSchema() {
  // 展览
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${EXHIBITIONS_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT NULL,
      cover_image TEXT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'draft',
      start_at DATETIME NULL,
      end_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_exhibitions_status_created (status, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 展览作品（可挂 original 或 digital）
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${EXHIBITION_ITEMS_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exhibition_id INT NOT NULL,
      artwork_type VARCHAR(20) NOT NULL,
      artwork_id VARCHAR(64) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_item_exhibition_sort (exhibition_id, sort_order),
      INDEX idx_item_artwork (artwork_type, artwork_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // 展览作品与艺术家关联（支持多艺术家）
  await db.query(`
    CREATE TABLE IF NOT EXISTS ${EXHIBITION_ITEM_ARTISTS_TABLE} (
      id INT AUTO_INCREMENT PRIMARY KEY,
      exhibition_item_id INT NOT NULL,
      artist_id INT NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_item_artist (exhibition_item_id, artist_id),
      INDEX idx_item_artist_sort (exhibition_item_id, sort_order),
      INDEX idx_item_artist_id (artist_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
}

async function ensureSchemaReady() {
  if (schemaReady) return;
  await ensureSchema();
  schemaReady = true;
}

router.use(async (req, res, next) => {
  try {
    await ensureSchemaReady();
    next();
  } catch (e) {
    next(e);
  }
});

async function getExhibitionItems(exhibitionId) {
  const [itemRows] = await db.query(
    `
    SELECT id, exhibition_id, artwork_type, artwork_id, sort_order
    FROM ${EXHIBITION_ITEMS_TABLE}
    WHERE exhibition_id = ?
    ORDER BY sort_order ASC, id ASC
    `,
    [exhibitionId]
  );

  return itemRows || [];
}

async function getArtistsByExhibitionItemIds(itemIds) {
  if (!itemIds.length) return new Map();

  const placeholders = itemIds.map(() => '?').join(',');
  const [rows] = await db.query(
    `
      SELECT
        eia.exhibition_item_id,
        eia.sort_order,
        a.id AS artist_id,
        a.name AS artist_name,
        a.avatar AS artist_avatar,
        a.description AS artist_description
      FROM ${EXHIBITION_ITEM_ARTISTS_TABLE} eia
      JOIN artists a ON a.id = eia.artist_id
      WHERE eia.exhibition_item_id IN (${placeholders})
      ORDER BY eia.exhibition_item_id ASC, eia.sort_order ASC
    `,
    itemIds
  );

  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.exhibition_item_id)) map.set(row.exhibition_item_id, []);
    map.get(row.exhibition_item_id).push({
      id: row.artist_id,
      name: row.artist_name,
      avatar: row.artist_avatar ? processObjectImages({ avatar: row.artist_avatar }, ['avatar']).avatar : '',
      description: row.artist_description || null,
    });
  }
  return map;
}

async function getOriginalArtworksByIds(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.query(
    `
      SELECT
        oa.id AS artwork_id,
        oa.title,
        oa.year,
        oa.image,
        oa.description,
        oa.price,
        oa.stock,
        oa.is_on_sale,
        oa.created_at,
        oa.artist_id
      FROM original_artworks oa
      WHERE oa.id IN (${placeholders})
    `,
    ids
  );
  const map = new Map();
  for (const r of rows || []) {
    const processed = processObjectImages(r, ['image']);
    map.set(String(r.artwork_id), {
      id: r.artwork_id,
      title: r.title,
      year: r.year,
      image: processed.image || '',
      description: r.description || null,
      price: r.price ?? 0,
      stock: r.stock ?? null,
      is_on_sale: !!r.is_on_sale,
      created_at: r.created_at || null,
      artist_id: r.artist_id || null,
    });
  }
  return map;
}

async function getDigitalArtworksByIds(ids) {
  if (!ids.length) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const [rows] = await db.query(
    `
      SELECT
        dae.id AS artwork_id,
        dae.title,
        dae.image_url,
        dae.description,
        dae.price,
        dae.created_at,
        dae.artist_id
      FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} dae
      WHERE dae.id IN (${placeholders})
    `,
    ids
  );
  const map = new Map();
  for (const r of rows || []) {
    const processed = processObjectImages({ image_url: r.image_url }, ['image_url']);
    map.set(String(r.artwork_id), {
      id: r.artwork_id,
      title: r.title,
      image: processed.image_url || '',
      description: r.description || null,
      price: r.price ?? 0,
      created_at: r.created_at || null,
      artist_id: r.artist_id || null,
    });
  }
  return map;
}

async function getExhibitionDetail(exhibitionId) {
  const [rows] = await db.query(
    `
      SELECT *
      FROM ${EXHIBITIONS_TABLE}
      WHERE id = ?
      LIMIT 1
    `,
    [exhibitionId]
  );
  if (!rows || rows.length === 0) return null;

  const exhibition = processObjectImages(rows[0], ['cover_image']);
  const items = await getExhibitionItems(exhibitionId);
  const itemIds = items.map((i) => i.id);
  const artistsMap = await getArtistsByExhibitionItemIds(itemIds);

  const originalArtworkIds = [];
  const digitalArtworkIds = [];
  for (const it of items) {
    if (it.artwork_type === 'original') originalArtworkIds.push(parsePositiveInt(it.artwork_id));
    if (it.artwork_type === 'digital') digitalArtworkIds.push(String(it.artwork_id));
  }
  const originalArtworkMap = await getOriginalArtworksByIds(originalArtworkIds.filter(Boolean));
  const digitalArtworkMap = await getDigitalArtworksByIds(digitalArtworkIds);

  const enrichedItems = items.map((it) => {
    const artists = artistsMap.get(it.id) || [];

    let artwork = null;
    if (it.artwork_type === 'original') {
      artwork = originalArtworkMap.get(String(it.artwork_id)) || null;
    } else if (it.artwork_type === 'digital') {
      artwork = digitalArtworkMap.get(String(it.artwork_id)) || null;
    }

    return {
      id: it.id,
      sort_order: it.sort_order,
      artwork_type: it.artwork_type,
      artwork,
      artists,
    };
  });

  return {
    exhibition: {
      id: exhibition.id,
      title: exhibition.title,
      description: exhibition.description || null,
      cover_image: exhibition.cover_image || null,
      status: exhibition.status,
      start_at: exhibition.start_at || null,
      end_at: exhibition.end_at || null,
      created_at: exhibition.created_at,
      updated_at: exhibition.updated_at,
    },
    items: enrichedItems,
    items_total: enrichedItems.length,
  };
}

async function validateArtistsExist(artistIds) {
  if (!artistIds.length) return [];
  const placeholders = artistIds.map(() => '?').join(',');
  const [rows] = await db.query(`SELECT id FROM artists WHERE id IN (${placeholders})`, artistIds);
  const exists = new Set((rows || []).map((r) => r.id));
  const missing = artistIds.filter((id) => !exists.has(id));
  if (missing.length) {
    const err = new Error('存在不存在的艺术家ID');
    err.statusCode = 400;
    err.missing_artist_ids = missing;
    throw err;
  }
  return rows;
}

async function fetchArtworkArtistIds(items) {
  const originalArtworkIds = uniqPreserveOrder(
    items
      .filter((it) => it.artwork_type === 'original')
      .map((it) => parsePositiveInt(it.artwork_id))
      .filter(Boolean)
  );
  const digitalArtworkIds = uniqPreserveOrder(
    items.filter((it) => it.artwork_type === 'digital').map((it) => String(it.artwork_id))
  );

  const originalArtistByArtworkId = new Map();
  if (originalArtworkIds.length) {
    const placeholders = originalArtworkIds.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT id AS artwork_id, artist_id FROM original_artworks WHERE id IN (${placeholders})`,
      originalArtworkIds
    );
    for (const r of rows || []) {
      originalArtistByArtworkId.set(String(r.artwork_id), r.artist_id || null);
    }
  }

  const digitalArtistByArtworkId = new Map();
  if (digitalArtworkIds.length) {
    const placeholders = digitalArtworkIds.map(() => '?').join(',');
    const [rows] = await db.query(
      `SELECT id AS artwork_id, artist_id FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} WHERE id IN (${placeholders})`,
      digitalArtworkIds
    );
    for (const r of rows || []) {
      digitalArtistByArtworkId.set(String(r.artwork_id), r.artist_id || null);
    }
  }

  return { originalArtistByArtworkId, digitalArtistByArtworkId };
}

async function ensureExhibitionExists(exhibitionId) {
  const [rows] = await db.query(`SELECT id FROM ${EXHIBITIONS_TABLE} WHERE id = ? LIMIT 1`, [exhibitionId]);
  if (!rows || rows.length === 0) return false;
  return true;
}

function pickArtistsForItem(item, artworkArtistByArtworkId) {
  if (item.artists && Array.isArray(item.artists) && item.artists.length > 0) return item.artists;
  if (item.artwork_type === 'original') {
    return artworkArtistByArtworkId.originalArtistByArtworkId.get(String(item.artwork_id)) ? [
      artworkArtistByArtworkId.originalArtistByArtworkId.get(String(item.artwork_id))
    ] : [];
  }
  if (item.artwork_type === 'digital') {
    return artworkArtistByArtworkId.digitalArtistByArtworkId.get(String(item.artwork_id)) ? [
      artworkArtistByArtworkId.digitalArtistByArtworkId.get(String(item.artwork_id))
    ] : [];
  }
  return [];
}

function normalizeArtistsList(rawArtists) {
  if (!rawArtists) return [];
  let arr = rawArtists;
  if (typeof rawArtists === 'string') arr = rawArtists.split(',');
  if (!Array.isArray(arr)) return [];
  const parsed = arr
    .map((id) => parsePositiveInt(id))
    .filter((id) => id !== null);
  return uniqPreserveOrder(parsed);
}

// 查询展览列表（公开）
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const sizeNum = Math.min(100, Math.max(1, parseInt(pageSize) || 20));
    const offset = (pageNum - 1) * sizeNum;

    const where = [];
    const params = [];
    if (status) {
      const s = String(status).trim();
      if (!['draft', 'published'].includes(s)) {
        return res.status(400).json({ error: 'status 仅支持 draft/published' });
      }
      where.push('status = ?');
      params.push(s);
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM ${EXHIBITIONS_TABLE} ${whereClause}`;
    const [[{ total }]] = await db.query(countSql, params);

    const listSql = `
      SELECT
        id, title, cover_image, status, start_at, end_at, created_at, updated_at
      FROM ${EXHIBITIONS_TABLE}
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await db.query(listSql, [...params, sizeNum, offset]);
    const data = (rows || []).map((r) => {
      const processed = processObjectImages(r, ['cover_image']);
      return {
        id: processed.id,
        title: processed.title,
        cover_image: processed.cover_image || null,
        status: processed.status,
        start_at: processed.start_at || null,
        end_at: processed.end_at || null,
        created_at: processed.created_at,
        updated_at: processed.updated_at,
      };
    });

    res.json({ data, pagination: { page: pageNum, pageSize: sizeNum, total: total || 0 } });
  } catch (e) {
    console.error('get exhibitions failed:', e);
    res.status(500).json({ error: '获取展览列表失败' });
  }
});

// 查询展览详情（公开）
router.get('/:id', async (req, res) => {
  try {
    const exhibitionId = parsePositiveInt(req.params.id);
    if (!exhibitionId) return res.status(400).json({ error: '无效的展览ID' });

    const detail = await getExhibitionDetail(exhibitionId);
    if (!detail) return res.status(404).json({ error: '展览不存在' });
    res.json(detail);
  } catch (e) {
    console.error('get exhibition detail failed:', e);
    res.status(500).json({ error: '获取展览详情失败' });
  }
});

// 查询展览作品列表（公开）
router.get('/:id/items', async (req, res) => {
  try {
    const exhibitionId = parsePositiveInt(req.params.id);
    if (!exhibitionId) return res.status(400).json({ error: '无效的展览ID' });

    const detail = await getExhibitionDetail(exhibitionId);
    if (!detail) return res.status(404).json({ error: '展览不存在' });
    res.json({ items: detail.items, items_total: detail.items_total });
  } catch (e) {
    console.error('get exhibition items failed:', e);
    res.status(500).json({ error: '获取展览作品失败' });
  }
});

// 创建展览（需要 admin）
router.post('/', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const { title, description, cover_image, start_at, end_at, status } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'title 不能为空' });
    }

    if (cover_image !== undefined && cover_image !== null && cover_image !== '') {
      if (!validateImageUrl(cover_image)) return res.status(400).json({ error: '无效的 cover_image URL' });
    }

    const cleanTitle = title.trim();
    const cleanDescription = description ? String(description) : null;
    const cleanStatus = status ? String(status).trim() : 'draft';
    if (!['draft', 'published'].includes(cleanStatus)) {
      return res.status(400).json({ error: 'status 仅支持 draft/published' });
    }

    const startAt = start_at ? new Date(start_at) : null;
    const endAt = end_at ? new Date(end_at) : null;
    if (start_at && isNaN(startAt.getTime())) return res.status(400).json({ error: 'start_at 无效' });
    if (end_at && isNaN(endAt.getTime())) return res.status(400).json({ error: 'end_at 无效' });

    const [result] = await db.query(
      `
        INSERT INTO ${EXHIBITIONS_TABLE} (title, description, cover_image, status, start_at, end_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        cleanTitle,
        cleanDescription,
        cover_image || null,
        cleanStatus,
        start_at ? startAt.toISOString().slice(0, 19).replace('T', ' ') : null,
        end_at ? endAt.toISOString().slice(0, 19).replace('T', ' ') : null,
      ]
    );

    res.json({
      id: result.insertId,
      title: cleanTitle,
      status: cleanStatus,
      cover_image: cover_image || null,
    });
  } catch (e) {
    console.error('create exhibition failed:', e);
    res.status(500).json({ error: '创建展览失败' });
  }
});

// 修改展览（需要 admin）
router.put('/:id', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const exhibitionId = parsePositiveInt(req.params.id);
    if (!exhibitionId) return res.status(400).json({ error: '无效的展览ID' });

    const { title, description, cover_image, start_at, end_at, status } = req.body || {};

    const updateFields = [];
    const updateValues = [];

    if (title !== undefined) {
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({ error: 'title 不能为空' });
      }
      updateFields.push('title = ?');
      updateValues.push(title.trim());
    }

    if (description !== undefined) {
      updateFields.push('description = ?');
      updateValues.push(description ? String(description) : null);
    }

    if (cover_image !== undefined) {
      if (cover_image === null || cover_image === '') {
        updateFields.push('cover_image = ?');
        updateValues.push(null);
      } else {
        if (!validateImageUrl(cover_image)) return res.status(400).json({ error: '无效的 cover_image URL' });
        updateFields.push('cover_image = ?');
        updateValues.push(cover_image);
      }
    }

    if (status !== undefined) {
      const cleanStatus = String(status).trim();
      if (!['draft', 'published'].includes(cleanStatus)) {
        return res.status(400).json({ error: 'status 仅支持 draft/published' });
      }
      updateFields.push('status = ?');
      updateValues.push(cleanStatus);
    }

    if (start_at !== undefined) {
      if (!start_at) {
        updateFields.push('start_at = ?');
        updateValues.push(null);
      } else {
        const d = new Date(start_at);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'start_at 无效' });
        updateFields.push('start_at = ?');
        updateValues.push(d.toISOString().slice(0, 19).replace('T', ' '));
      }
    }

    if (end_at !== undefined) {
      if (!end_at) {
        updateFields.push('end_at = ?');
        updateValues.push(null);
      } else {
        const d = new Date(end_at);
        if (isNaN(d.getTime())) return res.status(400).json({ error: 'end_at 无效' });
        updateFields.push('end_at = ?');
        updateValues.push(d.toISOString().slice(0, 19).replace('T', ' '));
      }
    }

    if (!updateFields.length) {
      return res.status(400).json({ error: '未提供可更新字段' });
    }

    updateFields.push('updated_at = CURRENT_TIMESTAMP');
    updateValues.push(exhibitionId);

    const [result] = await db.query(
      `UPDATE ${EXHIBITIONS_TABLE} SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    if (!result || result.affectedRows === 0) return res.status(404).json({ error: '展览不存在' });

    const detail = await getExhibitionDetail(exhibitionId);
    res.json({ message: '更新成功', detail });
  } catch (e) {
    console.error('update exhibition failed:', e);
    res.status(500).json({ error: '更新展览失败' });
  }
});

function normalizeItemsRequest(body) {
  const items = body && Array.isArray(body.items) ? body.items : null;
  if (!items) return null;
  if (items.length === 0) return [];
  if (items.length > 500) throw Object.assign(new Error('items too many'), { statusCode: 400 });
  return items;
}

async function validateAndPrepareItems(exhibitionId, rawItems, mode) {
  // mode: 'replace'|'append' 仅用于错误信息
  if (!Array.isArray(rawItems)) throw Object.assign(new Error('items 必须为数组'), { statusCode: 400 });

  const normalized = [];
  for (const it of rawItems) {
    const artwork_type = normalizeArtworkType(it.artwork_type);
    if (!artwork_type) throw Object.assign(new Error('artwork_type 无效'), { statusCode: 400 });

    let artwork_id = null;
    if (artwork_type === 'original') {
      const aid = parsePositiveInt(it.artwork_id);
      if (!aid) throw Object.assign(new Error('original artwork_id 无效'), { statusCode: 400 });
      artwork_id = String(aid);
    } else {
      const did = parseDigitalArtworkId(it.artwork_id);
      if (!did) throw Object.assign(new Error('digital artwork_id 无效'), { statusCode: 400 });
      artwork_id = did;
    }

    const sort_order = it.sort_order === undefined || it.sort_order === null ? 0 : parseInt(it.sort_order, 10);
    const cleanSort = Number.isNaN(sort_order) ? 0 : sort_order;

    const artists = it.artists !== undefined ? normalizeArtistsList(it.artists) : [];

    normalized.push({
      exhibition_id: exhibitionId,
      artwork_type,
      artwork_id,
      sort_order: cleanSort,
      artists,
    });
  }

  const artistsProvidedIds = [];
  for (const it of normalized) {
    for (const aid of it.artists) artistsProvidedIds.push(aid);
  }
  const allArtistsProvided = uniqPreserveOrder(artistsProvidedIds);
  if (allArtistsProvided.length) await validateArtistsExist(allArtistsProvided);

  const { originalArtistByArtworkId, digitalArtistByArtworkId } = await fetchArtworkArtistIds(normalized);

  // 为每个 item 决定最终 artists：若未提供，则使用 artwork 自带 artist_id
  for (const it of normalized) {
    if (it.artwork_type === 'original') {
      if (!originalArtistByArtworkId.has(String(it.artwork_id))) {
        const err = new Error(`original artwork 不存在: ${it.artwork_id}`);
        err.statusCode = 404;
        throw err;
      }
    } else if (it.artwork_type === 'digital') {
      if (!digitalArtistByArtworkId.has(String(it.artwork_id))) {
        const err = new Error(`digital artwork 不存在: ${it.artwork_id}`);
        err.statusCode = 404;
        throw err;
      }
    }

    let finalArtists = pickArtistsForItem(it, {
      originalArtistByArtworkId,
      digitalArtistByArtworkId,
    });

    finalArtists = uniqPreserveOrder(finalArtists);
    if (!finalArtists.length) {
      const err = new Error(`无法为该展览作品匹配 artist_id，请为 item artwork_id=${it.artwork_id} 提供 artists 列表`);
      err.statusCode = 400;
      throw err;
    }
    it.artists = finalArtists;
  }

  return normalized;
}

async function insertItemsAndArtists(connection, exhibitionId, normalizedItems) {
  const insertedItemIds = [];
  for (const it of normalizedItems) {
    const [res] = await connection.query(
      `
        INSERT INTO ${EXHIBITION_ITEMS_TABLE} (exhibition_id, artwork_type, artwork_id, sort_order)
        VALUES (?, ?, ?, ?)
      `,
      [exhibitionId, it.artwork_type, it.artwork_id, it.sort_order]
    );
    const itemId = res.insertId;
    insertedItemIds.push(itemId);

    const values = it.artists.map((artistId, idx) => [itemId, artistId, idx + 1]);
    if (values.length) {
      await connection.query(
        `
          INSERT INTO ${EXHIBITION_ITEM_ARTISTS_TABLE} (exhibition_item_id, artist_id, sort_order)
          VALUES ?
        `,
        [values]
      );
    }
  }
  return insertedItemIds;
}

// 追加展览作品（需要 admin）
router.post('/:id/items', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const exhibitionId = parsePositiveInt(req.params.id);
    if (!exhibitionId) return res.status(400).json({ error: '无效的展览ID' });
    if (!await ensureExhibitionExists(exhibitionId)) return res.status(404).json({ error: '展览不存在' });

    const rawItems = normalizeItemsRequest(req.body);
    if (rawItems === null) return res.status(400).json({ error: '缺少 items 数组' });

    // 为 sort_order 补齐默认值（按请求顺序）
    for (let i = 0; i < rawItems.length; i++) {
      if (rawItems[i].sort_order === undefined || rawItems[i].sort_order === null) rawItems[i].sort_order = i + 1;
    }

    const normalized = await validateAndPrepareItems(exhibitionId, rawItems, 'append');

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      const insertedItemIds = await insertItemsAndArtists(connection, exhibitionId, normalized);
      await connection.commit();
      connection.release();
      res.json({ message: '已追加展览作品', inserted_item_ids: insertedItemIds, items_total: insertedItemIds.length });
    } catch (e) {
      await connection.rollback();
      connection.release();
      throw e;
    }
  } catch (e) {
    console.error('append exhibition items failed:', e);
    const statusCode = e && e.statusCode ? e.statusCode : 500;
    res.status(statusCode).json({ error: e.message || '追加展览作品失败' });
  }
});

// 替换展览作品（需要 admin）
router.put('/:id/items', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const exhibitionId = parsePositiveInt(req.params.id);
    if (!exhibitionId) return res.status(400).json({ error: '无效的展览ID' });
    if (!await ensureExhibitionExists(exhibitionId)) return res.status(404).json({ error: '展览不存在' });

    const rawItems = normalizeItemsRequest(req.body);
    if (rawItems === null) return res.status(400).json({ error: '缺少 items 数组' });

    for (let i = 0; i < rawItems.length; i++) {
      if (rawItems[i].sort_order === undefined || rawItems[i].sort_order === null) rawItems[i].sort_order = i + 1;
    }

    const normalized = await validateAndPrepareItems(exhibitionId, rawItems, 'replace');

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      await connection.query(
        `
          DELETE FROM ${EXHIBITION_ITEM_ARTISTS_TABLE}
          WHERE exhibition_item_id IN (
            SELECT id FROM ${EXHIBITION_ITEMS_TABLE} WHERE exhibition_id = ?
          )
        `,
        [exhibitionId]
      );
      await connection.query(`DELETE FROM ${EXHIBITION_ITEMS_TABLE} WHERE exhibition_id = ?`, [exhibitionId]);

      const insertedItemIds = await insertItemsAndArtists(connection, exhibitionId, normalized);
      await connection.commit();
      connection.release();

      const detail = await getExhibitionDetail(exhibitionId);
      res.json({ message: '已替换展览作品', detail, inserted_item_ids: insertedItemIds });
    } catch (e) {
      await connection.rollback();
      connection.release();
      throw e;
    }
  } catch (e) {
    console.error('replace exhibition items failed:', e);
    const statusCode = e && e.statusCode ? e.statusCode : 500;
    res.status(statusCode).json({ error: e.message || '替换展览作品失败' });
  }
});

// 为某个展览作品关联/更新艺术家（需要 admin）
router.put('/:exhibitionId/items/:itemId/artists', authenticateToken, checkRole(['admin']), async (req, res) => {
  try {
    const exhibitionId = parsePositiveInt(req.params.exhibitionId);
    const itemId = parsePositiveInt(req.params.itemId);
    if (!exhibitionId || !itemId) return res.status(400).json({ error: '无效的展览ID或展览作品ID' });

    const artistIds = normalizeArtistsList(req.body && (req.body.artist_ids || req.body.artists));

    const connection = await db.getConnection();
    await connection.beginTransaction();
    try {
      const [itemRows] = await connection.query(
        `SELECT id FROM ${EXHIBITION_ITEMS_TABLE} WHERE id = ? AND exhibition_id = ? LIMIT 1`,
        [itemId, exhibitionId]
      );
      if (!itemRows || itemRows.length === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: '展览作品不存在' });
      }

      if (artistIds.length) {
        const placeholders = artistIds.map(() => '?').join(',');
        const [rows] = await connection.query(`SELECT id FROM artists WHERE id IN (${placeholders})`, artistIds);
        const exists = new Set((rows || []).map((r) => r.id));
        const missing = artistIds.filter((id) => !exists.has(id));
        if (missing.length) {
          await connection.rollback();
          connection.release();
          return res.status(400).json({ error: '存在不存在的艺术家ID', missing_artist_ids: missing });
        }
      }

      await connection.query(
        `DELETE FROM ${EXHIBITION_ITEM_ARTISTS_TABLE} WHERE exhibition_item_id = ?`,
        [itemId]
      );

      if (artistIds.length) {
        const values = artistIds.map((aid, idx) => [itemId, aid, idx + 1]);
        await connection.query(
          `
            INSERT INTO ${EXHIBITION_ITEM_ARTISTS_TABLE} (exhibition_item_id, artist_id, sort_order)
            VALUES ?
          `,
          [values]
        );
      }

      await connection.commit();
      connection.release();

      const detail = await getExhibitionDetail(exhibitionId);
      res.json({ message: '艺术家关联已更新', item_id: itemId, detail });
    } catch (e) {
      await connection.rollback();
      connection.release();
      throw e;
    }
  } catch (e) {
    console.error('update exhibition item artists failed:', e);
    const statusCode = e && e.statusCode ? e.statusCode : 500;
    res.status(statusCode).json({ error: e.message || '更新艺术家关联失败' });
  }
});

module.exports = router;

