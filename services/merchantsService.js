const db = require('../db');
const logger = require('../utils/logger');
const { uploadToOSS } = require('../config/oss');
const { processObjectImages } = require('../utils/image');
const { validatePublicImageUrl: validateImageUrl } = require('../config/publicEnv');
const redisClient = require('../utils/redisClient');
const { invalidateGeocodeCaches } = require('./mapGeocodeService');

const REDIS_MERCHANTS_LIST_KEY_PREFIX = 'merchants:list:';
const REDIS_MERCHANT_DETAIL_KEY_PREFIX = 'merchants:detail:';
const REDIS_MERCHANT_LIST_TTL_SEC = parseInt(process.env.MERCHANT_LIST_CACHE_TTL_SEC || '1800', 10);
const REDIS_MERCHANT_DETAIL_TTL_SEC = parseInt(process.env.MERCHANT_DETAIL_CACHE_TTL_SEC || '3600', 10);

function buildMerchantsListCacheKey({ page, limit, search, status, sort_by, sort_order }) {
  return `${REDIS_MERCHANTS_LIST_KEY_PREFIX}${page}:${limit}:${search || ''}:${status || ''}:${sort_by}:${sort_order}`;
}

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

async function getPublicMerchantsList(query) {
  const {
    page = 1,
    limit = 10,
    search = '',
    status = 'active',
    sort_by = 'created_at',
    sort_order = 'DESC',
  } = query || {};

  const cleanPage = parseInt(page, 10);
  const cleanLimit = parseInt(limit, 10);

  if (Number.isNaN(cleanPage) || cleanPage < 1) {
    return adminResult(400, { error: '页码必须是大于0的整数' });
  }
  if (Number.isNaN(cleanLimit) || cleanLimit < 1 || cleanLimit > 100) {
    return adminResult(400, { error: '每页数量必须在1-100之间' });
  }

  const validStatuses = ['active', 'inactive', 'pending'];
  if (status && !validStatuses.includes(status)) {
    return adminResult(400, { error: '无效的状态参数' });
  }
  if (search && typeof search === 'string' && search.length > 100) {
    return adminResult(400, { error: '搜索关键词长度不能超过100个字符' });
  }

  const offset = (cleanPage - 1) * cleanLimit;

  let whereClause = 'WHERE 1=1';
  const params = [];

  if (status) {
    whereClause += ' AND status = ?';
    params.push(status);
  }
  if (search) {
    whereClause += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  const allowedSortFields = ['created_at', 'sort_order', 'name'];
  const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
  const orderDirection = String(sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const cacheKey = buildMerchantsListCacheKey({
    page: cleanPage,
    limit: cleanLimit,
    search: search || '',
    status: status || '',
    sort_by: sortField,
    sort_order: orderDirection,
  });

  try {
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return adminResult(200, JSON.parse(cached));
      }
    } catch (redisError) {
      logger.warn('读取商家列表缓存失败', { err: redisError?.message || redisError });
    }

    const [[countResult], [merchants]] = await Promise.all([
      db.query(`SELECT COUNT(*) as total FROM merchants ${whereClause}`, params),
      db.query(
        `SELECT id, name, logo, description, address, phone, status, created_at, updated_at FROM merchants 
       ${whereClause}
       ORDER BY ${sortField} ${orderDirection}
       LIMIT ? OFFSET ?`,
        [...params, cleanLimit, offset]
      ),
    ]);

    const total = countResult[0].total;

    const merchantIds = merchants.map((m) => m.id);
    const imagesMap = {};
    if (merchantIds.length > 0) {
      const [allImages] = await db.query('SELECT merchant_id, image_url FROM merchant_images WHERE merchant_id IN (?)', [
        merchantIds,
      ]);
      allImages.forEach((img) => {
        if (!imagesMap[img.merchant_id]) imagesMap[img.merchant_id] = [];
        imagesMap[img.merchant_id].push(img.image_url);
      });
    }

    const merchantsWithImages = merchants.map((merchant) => ({
      ...merchant,
      images: imagesMap[merchant.id] || [],
    }));

    const merchantsWithProcessedImages = merchantsWithImages.map((merchant) =>
      processObjectImages(merchant, ['logo', 'images'])
    );

    const payload = {
      success: true,
      data: merchantsWithProcessedImages,
      pagination: {
        total,
        page: cleanPage,
        limit: cleanLimit,
        total_pages: Math.ceil(total / cleanLimit),
      },
    };

    try {
      await redisClient.setEx(cacheKey, REDIS_MERCHANT_LIST_TTL_SEC, JSON.stringify(payload));
    } catch (redisError) {
      logger.warn('写入商家列表缓存失败', { err: redisError?.message || redisError });
    }

    return adminResult(200, payload);
  } catch (error) {
    logger.error('getPublicMerchantsList failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '获取商家列表服务暂时不可用',
    });
  }
}

async function getPublicMerchantDetail(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的商家ID' });

  try {
    const cacheKey = REDIS_MERCHANT_DETAIL_KEY_PREFIX + id;
    const cache = await redisClient.get(cacheKey);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }

    const [merchants] = await db.query(
      'SELECT id, name, logo, description, address, phone, status, created_at, updated_at FROM merchants WHERE id = ? AND status = "active"',
      [id]
    );

    if (!merchants || merchants.length === 0) {
      return adminResult(404, {
        success: false,
        error: '商家不存在',
      });
    }

    const merchant = merchants[0];
    const [images] = await db.query('SELECT image_url FROM merchant_images WHERE merchant_id = ?', [id]);

    const merchantWithProcessedImages = processObjectImages(
      {
        ...merchant,
        images: images.map((img) => img.image_url),
      },
      ['logo', 'images']
    );

    const result = {
      success: true,
      data: merchantWithProcessedImages,
    };
    try {
      await redisClient.setEx(cacheKey, REDIS_MERCHANT_DETAIL_TTL_SEC, JSON.stringify(result));
    } catch (redisError) {
      logger.warn('写入商家详情缓存失败', { err: redisError?.message || redisError });
    }
    return adminResult(200, result);
  } catch (error) {
    logger.error('getPublicMerchantDetail failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '获取商家详情服务暂时不可用',
    });
  }
}

async function uploadMerchantLogo(file) {
  try {
    if (!file) {
      return adminResult(400, { error: '没有上传文件' });
    }
    const result = await uploadToOSS(file);
    const processedResult = processObjectImages(result, ['url']);
    return adminResult(200, processedResult);
  } catch (error) {
    logger.error('uploadMerchantLogo failed', { err: error });
    return adminResult(500, { error: '商家Logo上传失败' });
  }
}

async function uploadMerchantImages(files) {
  try {
    if (!files || files.length === 0) {
      return adminResult(400, { error: '没有上传文件' });
    }
    const results = await Promise.all(files.map((f) => uploadToOSS(f)));
    const processedResults = results.map((result) => processObjectImages(result, ['url']));
    return adminResult(200, processedResults);
  } catch (error) {
    logger.error('uploadMerchantImages failed', { err: error });
    return adminResult(500, { error: '商家图片上传失败' });
  }
}

async function createMerchantAdmin(body) {
  const { name, logo, description, address, phone, images } = body || {};

  if (!validateImageUrl(logo)) {
    return adminResult(400, { error: '无效的Logo URL' });
  }

  let merchantId;
  try {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.query(
        'INSERT INTO merchants (name, logo, description, address, phone, status) VALUES (?, ?, ?, ?, ?, "active")',
        [name, logo, description, address, phone]
      );
      merchantId = result.insertId;

      if (images && images.length > 0) {
        const imageValues = images.map((image) => [merchantId, image]);
        await connection.query('INSERT INTO merchant_images (merchant_id, image_url) VALUES ?', [imageValues]);
      }

      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    const [newMerchant] = await db.query(
      'SELECT id, name, logo, description, address, phone, status, created_at, updated_at FROM merchants WHERE id = ?',
      [merchantId]
    );

    await redisClient.scanDelByPattern(`${REDIS_MERCHANTS_LIST_KEY_PREFIX}*`, { swallowError: true });
    return adminResult(200, {
      success: true,
      data: newMerchant[0],
    });
  } catch (error) {
    logger.error('createMerchantAdmin failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '创建商家失败',
    });
  }
}

async function updateMerchantAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的商家ID' });

  const { name, logo, description, address, phone, images } = body || {};

  if (!validateImageUrl(logo)) {
    return adminResult(400, { error: '无效的Logo URL' });
  }

  let previousAddress = null;
  try {
    const [existingRows] = await db.query('SELECT address FROM merchants WHERE id = ?', [id]);
    previousAddress = existingRows[0]?.address || null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        'UPDATE merchants SET name = ?, logo = ?, description = ?, address = ?, phone = ? WHERE id = ?',
        [name, logo, description, address, phone, id]
      );

      await connection.query('DELETE FROM merchant_images WHERE merchant_id = ?', [id]);

      if (images && images.length > 0) {
        const imageValues = images.map((image) => [id, image]);
        await connection.query('INSERT INTO merchant_images (merchant_id, image_url) VALUES ?', [imageValues]);
      }

      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    const [updatedMerchant] = await db.query(
      'SELECT id, name, logo, description, address, phone, status, created_at, updated_at FROM merchants WHERE id = ?',
      [id]
    );

    await redisClient.scanDelByPattern(`${REDIS_MERCHANTS_LIST_KEY_PREFIX}*`, { swallowError: true });
    await redisClient.del(REDIS_MERCHANT_DETAIL_KEY_PREFIX + id);
    await invalidateGeocodeCaches([previousAddress, address]);

    return adminResult(200, {
      success: true,
      data: updatedMerchant[0],
    });
  } catch (error) {
    logger.error('updateMerchantAdmin failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '更新商家失败',
    });
  }
}

async function deleteMerchantAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的商家ID' });

  let previousAddress = null;
  try {
    const [existingRows] = await db.query('SELECT address FROM merchants WHERE id = ?', [id]);
    previousAddress = existingRows[0]?.address || null;

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query('DELETE FROM merchant_images WHERE merchant_id = ?', [id]);
      await connection.query('DELETE FROM merchants WHERE id = ?', [id]);
      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    await redisClient.scanDelByPattern(`${REDIS_MERCHANTS_LIST_KEY_PREFIX}*`, { swallowError: true });
    await redisClient.del(REDIS_MERCHANT_DETAIL_KEY_PREFIX + id);
    await invalidateGeocodeCaches([previousAddress]);

    return adminResult(200, {
      success: true,
      message: '删除成功',
    });
  } catch (error) {
    logger.error('deleteMerchantAdmin failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '删除商家失败',
    });
  }
}

async function patchMerchantStatusAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的商家ID' });

  const { status } = body || {};
  if (!['active', 'inactive'].includes(status)) {
    return adminResult(400, {
      success: false,
      error: '无效的状态值',
    });
  }

  try {
    await db.query('UPDATE merchants SET status = ? WHERE id = ?', [status, id]);
    await redisClient.scanDelByPattern(`${REDIS_MERCHANTS_LIST_KEY_PREFIX}*`, { swallowError: true });
    await redisClient.del(REDIS_MERCHANT_DETAIL_KEY_PREFIX + id);
    return adminResult(200, {
      success: true,
      message: '状态更新成功',
    });
  } catch (error) {
    logger.error('patchMerchantStatusAdmin failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '更新商家状态失败',
    });
  }
}

async function patchMerchantSortAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的商家ID' });

  const { sort_order } = body || {};
  if (typeof sort_order !== 'number') {
    return adminResult(400, {
      success: false,
      error: '无效的排序值',
    });
  }

  try {
    await db.query('UPDATE merchants SET sort_order = ? WHERE id = ?', [sort_order, id]);
    await redisClient.scanDelByPattern(`${REDIS_MERCHANTS_LIST_KEY_PREFIX}*`, { swallowError: true });
    await redisClient.del(REDIS_MERCHANT_DETAIL_KEY_PREFIX + id);
    return adminResult(200, {
      success: true,
      message: '排序更新成功',
    });
  } catch (error) {
    logger.error('patchMerchantSortAdmin failed', { err: error });
    return adminResult(500, {
      success: false,
      error: '更新商家排序失败',
    });
  }
}

module.exports = {
  getPublicMerchantsList,
  getPublicMerchantDetail,
  uploadMerchantLogo,
  uploadMerchantImages,
  createMerchantAdmin,
  updateMerchantAdmin,
  deleteMerchantAdmin,
  patchMerchantStatusAdmin,
  patchMerchantSortAdmin,
};
