const db = require('../db');
const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const { validatePublicImageUrl: validateImageUrl } = require('../config/publicEnv');
const { invalidateArtistsListCache } = require('./artistsService');

const REDIS_ARTWORKS_LIST_KEY = 'artworks:list';
const REDIS_ARTWORKS_LIST_KEY_PREFIX = 'artworks:list:artist:';
const REDIS_ARTWORK_DETAIL_KEY_PREFIX = 'artworks:detail:';

/**
 * 清理原作公开接口相关 Redis：所有列表/分页/total 键 + 详情键。
 * 列表中展示的艺术家信息、`is_public`、价格等变化后都应调用，避免与 MySQL 不一致。
 * @param {{
 *   artworkDetailId?: number|string,
 *   artworkDetailIds?: Array<number|string>,
 *   listOnly?: boolean
 * }} [options]
 * - `listOnly: true`：仅清 `artworks:list*`（无详情删除）。
 * - 传 `artworkDetailIds`（非空数组）：清全部 `artworks:list*`，并逐个删除对应 `artworks:detail:{id}`（适合 WMS 批量同步）。
 * - 仅传 `artworkDetailId`：清列表 + 删除单条详情（适合单条 PATCH/PUT）。
 * - 不传或空：清列表 + `scanDel` 全部 `artworks:detail*`（适合艺术家变更、批量删作品等）。
 */
async function invalidateArtworksPublicCaches(options = {}) {
  const opts = options || {}
  if (opts.listOnly === true) {
    try {
      await redisClient.scanDelByPattern('artworks:list*')
    } catch (e) {
      logger.error('invalidateArtworksPublicCaches_list_only_failed', { err: e })
    }
    return
  }
  const idsRaw = opts.artworkDetailIds
  const batchIds =
    Array.isArray(idsRaw) && idsRaw.length > 0
      ? [...new Set(idsRaw.map((x) => parsePositiveIntId(x)).filter((id) => id != null))]
      : null
  const singleId =
    batchIds == null && opts.artworkDetailId != null && opts.artworkDetailId !== ''
      ? parsePositiveIntId(opts.artworkDetailId)
      : null
  try {
    await redisClient.scanDelByPattern('artworks:list*')
    if (batchIds && batchIds.length > 0) {
      for (const id of batchIds) {
        await redisClient.del(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id)
      }
    } else if (singleId) {
      await redisClient.del(REDIS_ARTWORK_DETAIL_KEY_PREFIX + singleId)
    } else {
      await redisClient.scanDelByPattern('artworks:detail*')
    }
  } catch (e) {
    logger.error('invalidateArtworksPublicCaches failed', { err: e })
  }
}

const performanceMetrics = {
  queryTimes: [],
  cacheHitRate: 0,
  totalRequests: 0,
};

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

/** 统一空格与 Unicode，减少「韦少东」与「韦少东 」重复插入 */
function normalizeArtistDisplayName(raw) {
  let s = String(raw ?? '')
    .replace(/\u3000/g, ' ')
    .trim();
  s = s.replace(/\s+/g, ' ');
  try {
    s = s.normalize('NFC');
  } catch {
    /* ignore */
  }
  return s;
}

/**
 * 按 ID 或名称解析艺术家；表内无同名记录时插入 `artists`（与后台创建接口列一致），并清理公开艺术家列表缓存。
 * @param {unknown} artist_id
 * @param {unknown} artist_name
 * @returns {Promise<number|null>}
 */
async function resolveFinalArtistId(artist_id, artist_name) {
  const parsedId =
    artist_id != null && artist_id !== '' ? parsePositiveIntId(artist_id) : null;
  if (parsedId) return parsedId;

  const name = normalizeArtistDisplayName(artist_name);
  if (!name) return null;

  const [existingArtists] = await db.query('SELECT id FROM artists WHERE name = ? LIMIT 1', [name]);
  if (existingArtists.length > 0) return existingArtists[0].id;

  try {
    const [artistResult] = await db.query(
      'INSERT INTO artists (avatar, name, description, institution_id) VALUES (?, ?, ?, ?)',
      [null, name, '', null]
    );
    await invalidateArtistsListCache();
    return artistResult.insertId;
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      const [again] = await db.query('SELECT id FROM artists WHERE name = ? LIMIT 1', [name]);
      if (again.length > 0) return again[0].id;
    }
    logger.error('resolveFinalArtistId_insert_failed', { err: e.message, code: e.code, name });
    throw e;
  }
}

/**
 * 公开列表（分页、缓存、异步写回带 processObjectImages 的缓存）
 */
async function getPublicArtworksList(query, includeHidden = false) {
  const startTime = Date.now();
  performanceMetrics.totalRequests++;

  try {
    const { artist_id, artwork_ids, page = 1, pageSize = 20 } = query || {};
    const pageNum = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
    const sizeNum = parseInt(pageSize, 10) > 0 ? parseInt(pageSize, 10) : 20;
    const offset = (pageNum - 1) * sizeNum;

    if (artist_id) {
      const artistId = parseInt(artist_id, 10);
      if (Number.isNaN(artistId) || artistId <= 0) {
        return adminResult(400, { error: '无效的艺术家ID' });
      }
    }

    let selectedArtworkIds = [];
    if (artwork_ids) {
      selectedArtworkIds = String(artwork_ids)
        .split(',')
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !Number.isNaN(id) && id > 0);
      selectedArtworkIds = Array.from(new Set(selectedArtworkIds));
      if (selectedArtworkIds.length === 0) {
        return adminResult(400, { error: '无效的作品ID列表' });
      }
      if (selectedArtworkIds.length > 200) {
        return adminResult(400, { error: '一次最多指定200个作品ID' });
      }
    }

    let cacheKey;
    const scopeSuffix = includeHidden ? ':all' : ':pub';
    if (artist_id && selectedArtworkIds.length > 0) {
      const idsKey = selectedArtworkIds.slice().sort((a, b) => a - b).join('-');
      cacheKey = `${REDIS_ARTWORKS_LIST_KEY_PREFIX}${artist_id}:ids:${idsKey}:${pageNum}:${sizeNum}${scopeSuffix}`;
    } else if (artist_id) {
      cacheKey = `${REDIS_ARTWORKS_LIST_KEY_PREFIX}${artist_id}:${pageNum}:${sizeNum}${scopeSuffix}`;
    } else {
      cacheKey = `${REDIS_ARTWORKS_LIST_KEY}:${pageNum}:${sizeNum}${scopeSuffix}`;
    }

    try {
      const cache = await redisClient.get(cacheKey);
      if (cache) {
        performanceMetrics.cacheHitRate =
          (performanceMetrics.cacheHitRate * (performanceMetrics.totalRequests - 1) + 1) /
          performanceMetrics.totalRequests;
        logger.info('artworks_list_cache_hit', { cacheKey, ms: Date.now() - startTime });
        return adminResult(200, JSON.parse(cache));
      }
    } catch (cacheError) {
      logger.warn('artworks_list_redis_read_failed', { err: cacheError });
    }

    const queryStartTime = Date.now();
    let sql = `
      SELECT 
        oa.id, oa.title, oa.year, oa.image, oa.price, oa.original_price, oa.discount_price,
        oa.is_on_sale, oa.stock, oa.sales, oa.created_at, oa.is_public,
        a.id as artist_id, a.name as artist_name, a.avatar as artist_avatar
      FROM original_artworks oa
      LEFT JOIN artists a ON oa.artist_id = a.id
    `;
    const whereClauses = [];
    const params = [];

    if (!includeHidden) {
      whereClauses.push('COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1');
    }

    if (artist_id) {
      whereClauses.push('oa.artist_id = ?');
      params.push(parseInt(artist_id, 10));
    }
    if (selectedArtworkIds.length > 0) {
      whereClauses.push(`oa.id IN (${selectedArtworkIds.map(() => '?').join(',')})`);
      params.push(...selectedArtworkIds);
    }

    if (whereClauses.length > 0) {
      sql += ` WHERE ${whereClauses.join(' AND ')}`;
    }

    sql += ' ORDER BY oa.created_at DESC LIMIT ?, ?';
    params.push(offset, sizeNum);

    const [rows] = await db.query(sql, params);
    const queryTime = Date.now() - queryStartTime;
    performanceMetrics.queryTimes.push(queryTime);
    logger.info('artworks_list_db_query', { query_ms: queryTime, sql_preview: sql.substring(0, 120) });

    if (!rows || !Array.isArray(rows)) {
      return adminResult(200, {
        data: [],
        pagination: { page: pageNum, pageSize: sizeNum, total: 0 },
      });
    }

    let total;
    let totalCacheKey;
    const totalScopeSuffix = includeHidden ? ':all' : ':pub';
    if (artist_id && selectedArtworkIds.length > 0) {
      const idsKey = selectedArtworkIds.slice().sort((a, b) => a - b).join('-');
      totalCacheKey = `${REDIS_ARTWORKS_LIST_KEY_PREFIX}${artist_id}:ids:${idsKey}:total${totalScopeSuffix}`;
    } else if (artist_id) {
      totalCacheKey = `${REDIS_ARTWORKS_LIST_KEY_PREFIX}${artist_id}:total${totalScopeSuffix}`;
    } else {
      totalCacheKey = `${REDIS_ARTWORKS_LIST_KEY}:total${totalScopeSuffix}`;
    }

    try {
      const totalCache = await redisClient.get(totalCacheKey);
      if (totalCache) {
        total = parseInt(totalCache, 10);
      } else {
        let countSql = `
          SELECT COUNT(*) as total
          FROM original_artworks oa 
          LEFT JOIN artists a ON oa.artist_id = a.id
        `;
        const countWhere = [];
        const countParams = [];
        if (!includeHidden) {
          countWhere.push('COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1');
        }
        if (artist_id) {
          countWhere.push('oa.artist_id = ?');
          countParams.push(parseInt(artist_id, 10));
        }
        if (selectedArtworkIds.length > 0) {
          countWhere.push(`oa.id IN (${selectedArtworkIds.map(() => '?').join(',')})`);
          countParams.push(...selectedArtworkIds);
        }
        if (countWhere.length > 0) {
          countSql += ` WHERE ${countWhere.join(' AND ')}`;
        }
        const [countRows] = await db.query(countSql, countParams);
        total = countRows[0].total;
        await redisClient.setEx(totalCacheKey, 300, total.toString());
      }
    } catch (countError) {
      logger.warn('artworks_list_total_fallback', { err: countError });
      total = rows.length === sizeNum ? (pageNum + 1) * sizeNum : pageNum * sizeNum;
    }

    const processImagesAsync = async () => {
      try {
        const artworksWithFullUrls = rows.map((artwork) => {
          const processedArtwork = processObjectImages(artwork, ['image', 'avatar']);
          return {
            ...processedArtwork,
            artist: {
              id: artwork.artist_id,
              name: artwork.artist_name,
              avatar: processedArtwork.artist_avatar || '',
            },
            collection: {
              location: artwork.collection_location,
              number: artwork.collection_number,
              size: artwork.collection_size,
              material: artwork.collection_material,
            },
          };
        });

        const result = {
          data: artworksWithFullUrls,
          pagination: { page: pageNum, pageSize: sizeNum, total },
        };

        try {
          await redisClient.setEx(cacheKey, 1800, JSON.stringify(result));
        } catch (cacheWriteError) {
          logger.warn('artworks_list_cache_write_failed', { err: cacheWriteError });
        }
      } catch (processError) {
        logger.error('artworks_list_process_images_failed', { err: processError });
      }
    };

    const immediateResult = {
      data: rows.map((artwork) => ({
        ...artwork,
        artist: {
          id: artwork.artist_id,
          name: artwork.artist_name,
          avatar: artwork.artist_avatar || '',
        },
        collection: {
          location: artwork.collection_location,
          number: artwork.collection_number,
          size: artwork.collection_size,
          material: artwork.collection_material,
        },
      })),
      pagination: { page: pageNum, pageSize: sizeNum, total },
    };

    processImagesAsync();

    logger.info('artworks_list_response', {
      total_ms: Date.now() - startTime,
      cache_hit_rate_pct: (performanceMetrics.cacheHitRate * 100).toFixed(2),
    });

    return adminResult(200, immediateResult);
  } catch (error) {
    logger.error('getPublicArtworksList failed', { err: error });
    return adminResult(500, { error: '获取艺术品列表服务暂时不可用' });
  }
}

async function getPublicArtworkDetail(rawId, includeHidden = false) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的作品ID' });
  try {
    if (!includeHidden) {
      const cache = await redisClient.get(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id);
      if (cache) {
        return adminResult(200, JSON.parse(cache));
      }
    }

    let sql = `
      SELECT 
        oa.*,
        a.id as artist_id,
        a.name as artist_name,
        a.avatar as artist_avatar,
        a.description as artist_description
      FROM original_artworks oa
      LEFT JOIN artists a ON oa.artist_id = a.id
      WHERE oa.id = ?
    `;
    const params = [id];
    if (!includeHidden) {
      sql += ' AND COALESCE(oa.is_public, 1) = 1 AND COALESCE(a.is_public, 1) = 1';
    }

    const [rows] = await db.query(sql, params);

    if (!rows || rows.length === 0) {
      return adminResult(404, { error: '作品不存在' });
    }

    const artwork = processObjectImages(rows[0], ['image', 'avatar']);
    const collection = {
      location: artwork.collection_location,
      number: artwork.collection_number,
      size: artwork.collection_size,
      material: artwork.collection_material,
    };
    const artist = {
      id: artwork.artist_id,
      name: artwork.artist_name,
      avatar: artwork.artist_avatar,
      description: artwork.artist_description,
    };
    const result = {
      id: artwork.id,
      title: artwork.title,
      year: artwork.year,
      image: artwork.image,
      description: artwork.description,
      long_description: artwork.long_description,
      background: artwork.background,
      features: artwork.features,
      collection,
      artist,
      price: artwork.price,
      stock: artwork.stock,
      discount_price: artwork.discount_price,
      original_price: artwork.original_price,
      sales: artwork.sales,
      is_on_sale: artwork.is_on_sale,
      is_public: artwork.is_public,
    };
    try {
      if (!includeHidden) {
        await redisClient.setEx(REDIS_ARTWORK_DETAIL_KEY_PREFIX + id, 604800, JSON.stringify(result));
      }
    } catch (e) {
      logger.warn('artwork_detail_cache_write_failed', { err: e });
    }
    return adminResult(200, result);
  } catch (error) {
    logger.error('getPublicArtworkDetail failed', { err: error });
    return adminResult(500, { error: '获取作品详情服务暂时不可用' });
  }
}

async function createOriginalArtworkAdmin(body) {
  const {
    title,
    image,
    artist_id,
    artist_name,
    year,
    description,
    long_description,
    background,
    features,
    collection_location,
    collection_number,
    collection_size,
    collection_material,
    price,
    original_price,
    discount_price,
  } = body || {};

  const is_public =
    body?.is_public === 0 || body?.is_public === false || body?.is_public === '0' ? 0 : 1;

  try {
    const finalArtistId = await resolveFinalArtistId(artist_id, artist_name);
    if (!finalArtistId) {
      return adminResult(400, { error: '缺少有效的艺术家ID' });
    }
    if (!validateImageUrl(image)) {
      return adminResult(400, { error: '无效的图片URL' });
    }
    const [result] = await db.query(
      `INSERT INTO original_artworks (
        title, image, artist_id, year, description, long_description,
        background, features, collection_location, 
        collection_number, collection_size, collection_material, price, original_price, discount_price, is_public
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        title,
        image,
        finalArtistId,
        year,
        description,
        long_description,
        background,
        features,
        collection_location,
        collection_number,
        collection_size,
        collection_material,
        price,
        original_price,
        discount_price,
        is_public,
      ]
    );
    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [finalArtistId]);
    const artist = artistRows[0] || {};
    await invalidateArtworksPublicCaches({ artworkDetailId: result.insertId });
    return adminResult(200, {
      id: result.insertId,
      title,
      price,
      image,
      year,
      description,
      long_description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material,
      },
      artist: { id: artist.id, name: artist.name },
    });
  } catch (error) {
    logger.error('createOriginalArtworkAdmin failed', { err: error });
    return adminResult(500, { error: '创建失败' });
  }
}

async function updateOriginalArtworkAdmin(rawId, body) {
  const artworkId = parsePositiveIntId(rawId);
  if (!artworkId) return adminResult(400, { error: '无效的作品ID' });

  const {
    title,
    image,
    artist_id,
    artist_name,
    year,
    description,
    long_description,
    background,
    features,
    collection_location,
    collection_number,
    collection_size,
    collection_material,
    original_price,
    discount_price,
    stock,
    sales,
    is_on_sale,
    price,
    is_public,
  } = body || {};

  try {
    const finalArtistId = await resolveFinalArtistId(artist_id, artist_name);
    if (!finalArtistId) {
      return adminResult(400, { error: '缺少有效的艺术家ID' });
    }

    const [existingRows] = await db.query('SELECT is_public FROM original_artworks WHERE id = ?', [artworkId]);
    if (!existingRows || existingRows.length === 0) {
      return adminResult(404, { error: '作品不存在' });
    }
    const resolvedIsPublic =
      is_public === undefined || is_public === null
        ? Number(existingRows[0].is_public) === 0
          ? 0
          : 1
        : is_public === 0 || is_public === false || is_public === '0'
          ? 0
          : 1;

    await db.query(
      `UPDATE original_artworks SET 
        title = ?, 
        image = ?, 
        artist_id = ?,
        year = ?,
        description = ?,
        long_description = ?,
        background = ?,
        features = ?,
        collection_location = ?,
        collection_number = ?,
        collection_size = ?,
        collection_material = ?,
        original_price = ?,
        discount_price = ?,
        stock = ?,
        sales = ?,
        is_on_sale = ?,
        is_public = ?
      WHERE id = ?`,
      [
        title,
        image,
        finalArtistId,
        year,
        description,
        long_description,
        background,
        features,
        collection_location,
        collection_number,
        collection_size,
        collection_material,
        original_price,
        discount_price,
        stock,
        sales,
        is_on_sale,
        resolvedIsPublic,
        artworkId,
      ]
    );

    const [artistRows] = await db.query('SELECT id, name FROM artists WHERE id = ?', [finalArtistId]);
    const artist = artistRows[0] || {};
    await invalidateArtworksPublicCaches({ artworkDetailId: artworkId });
    return adminResult(200, {
      id: artworkId,
      title,
      price,
      image,
      year,
      description,
      long_description,
      background,
      features,
      collection: {
        location: collection_location,
        number: collection_number,
        size: collection_size,
        material: collection_material,
      },
      artist: { id: artist.id, name: artist.name },
      original_price,
      discount_price,
      stock,
      sales,
      is_on_sale,
    });
  } catch (error) {
    logger.error('updateOriginalArtworkAdmin failed', { err: error });
    return adminResult(500, { error: '更新失败' });
  }
}

async function deleteOriginalArtworkAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的作品ID' });
  try {
    await db.query('DELETE FROM original_artworks WHERE id = ?', [id]);
    try {
      await db.query('DELETE FROM artist_featured_artworks WHERE artwork_id = ?', [id]);
    } catch (assocErr) {
      logger.warn('deleteOriginalArtworkAdmin_featured_cleanup', { err: assocErr });
    }
    await invalidateArtworksPublicCaches({ artworkDetailId: id });
    return adminResult(200, { message: '删除成功' });
  } catch (error) {
    logger.error('deleteOriginalArtworkAdmin failed', { err: error });
    return adminResult(500, { error: '删除失败' });
  }
}

function getArtworksPerformanceMetrics() {
  try {
    const redisMetrics = redisClient.getMetrics ? redisClient.getMetrics() : {};
    const dbMetrics = db.getPoolStatus ? db.getPoolStatus() : {};
    const avgQueryTime =
      performanceMetrics.queryTimes.length > 0
        ? performanceMetrics.queryTimes.reduce((a, b) => a + b, 0) / performanceMetrics.queryTimes.length
        : 0;
    const maxQueryTime = Math.max(...performanceMetrics.queryTimes, 0);
    const slowQueries = performanceMetrics.queryTimes.filter((time) => time > 1000).length;
    const metrics = {
      api: {
        totalRequests: performanceMetrics.totalRequests,
        cacheHitRate: `${(performanceMetrics.cacheHitRate * 100).toFixed(2)}%`,
        averageQueryTime: `${avgQueryTime.toFixed(2)}ms`,
        maxQueryTime: `${maxQueryTime}ms`,
        slowQueries,
        slowQueryRate:
          performanceMetrics.queryTimes.length > 0
            ? `${((slowQueries / performanceMetrics.queryTimes.length) * 100).toFixed(2)}%`
            : '0%',
      },
      redis: redisMetrics,
      database: dbMetrics,
      timestamp: new Date().toISOString(),
    };
    return adminResult(200, metrics);
  } catch (error) {
    logger.error('getArtworksPerformanceMetrics failed', { err: error });
    return adminResult(500, { error: '获取性能指标失败' });
  }
}

async function clearArtworksPerformanceCacheAdmin(body) {
  const { type = 'all' } = body || {};
  try {
    let clearedKeys = 0;
    if (type === 'all' || type === 'list') {
      clearedKeys += await redisClient.scanDelByPattern('artworks:list*');
    }
    if (type === 'all' || type === 'detail') {
      clearedKeys += await redisClient.scanDelByPattern('artworks:detail*');
    }
    return adminResult(200, { message: '缓存清理成功', clearedKeys, type });
  } catch (error) {
    logger.error('clearArtworksPerformanceCacheAdmin failed', { err: error });
    return adminResult(500, { error: '清理缓存失败' });
  }
}

function resetArtworksPerformanceMetrics() {
  try {
    performanceMetrics.queryTimes = [];
    performanceMetrics.cacheHitRate = 0;
    performanceMetrics.totalRequests = 0;
    return adminResult(200, { message: '性能统计已重置' });
  } catch (error) {
    logger.error('resetArtworksPerformanceMetrics failed', { err: error });
    return adminResult(500, { error: '重置性能统计失败' });
  }
}

/** 仅更新 is_public（列表内快速切换，避免 PUT 须带全量字段） */
async function patchOriginalArtworkIsPublicAdmin(rawId, body) {
  const artworkId = parsePositiveIntId(rawId);
  if (!artworkId) return adminResult(400, { error: '无效的作品ID' });
  const v = body && body.is_public;
  const isPublic = v === 0 || v === false || v === '0' ? 0 : 1;
  try {
    const [result] = await db.query('UPDATE original_artworks SET is_public = ? WHERE id = ?', [isPublic, artworkId]);
    if (!result || result.affectedRows === 0) return adminResult(404, { error: '作品不存在' });
    await invalidateArtworksPublicCaches({ artworkDetailId: artworkId });
    return adminResult(200, { id: artworkId, is_public: isPublic });
  } catch (e) {
    logger.error('patchOriginalArtworkIsPublicAdmin failed', { err: e });
    return adminResult(500, { error: '更新展示状态失败' });
  }
}

module.exports = {
  REDIS_ARTWORKS_LIST_KEY,
  REDIS_ARTWORKS_LIST_KEY_PREFIX,
  REDIS_ARTWORK_DETAIL_KEY_PREFIX,
  getPublicArtworksList,
  getPublicArtworkDetail,
  createOriginalArtworkAdmin,
  updateOriginalArtworkAdmin,
  deleteOriginalArtworkAdmin,
  getArtworksPerformanceMetrics,
  clearArtworksPerformanceCacheAdmin,
  resetArtworksPerformanceMetrics,
  resolveFinalArtistId,
  patchOriginalArtworkIsPublicAdmin,
  invalidateArtworksPublicCaches,
}
