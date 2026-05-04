const db = require('../db');
const redisClient = require('../utils/redisClient');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const { validatePublicImageUrl: validateImageUrl } = require('../config/publicEnv');

const REDIS_BANNERS_LIST_KEY = 'banners:list';
const REDIS_BANNERS_ALL_KEY = 'banners:all';

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

async function invalidateBannerCaches() {
  await redisClient.del(REDIS_BANNERS_LIST_KEY);
  await redisClient.del(REDIS_BANNERS_ALL_KEY);
}

function validateBannerFields(title, image_url, sort_order) {
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return adminResult(400, { error: '标题不能为空' });
  }
  if (title.length > 200) {
    return adminResult(400, { error: '标题长度不能超过200个字符' });
  }
  if (!image_url) {
    return adminResult(400, { error: '图片URL不能为空' });
  }
  if (!validateImageUrl(image_url)) {
    return adminResult(400, { error: '无效的图片URL' });
  }
  const cleanSortOrder = parseInt(sort_order, 10) || 0;
  if (cleanSortOrder < 0 || cleanSortOrder > 9999) {
    return adminResult(400, { error: '排序值必须在0-9999之间' });
  }
  return { ok: true, title: title.trim(), cleanSortOrder };
}

async function getPublicBannersList() {
  try {
    const cache = await redisClient.get(REDIS_BANNERS_LIST_KEY);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }
    const [banners] = await db.query(
      'SELECT id, title, image_url, link_url, sort_order FROM banners WHERE status = "active" ORDER BY sort_order ASC'
    );
    const bannersWithProcessedImages = (banners || []).map((banner) =>
      processObjectImages(banner, ['image_url'])
    );
    try {
      await redisClient.set(REDIS_BANNERS_LIST_KEY, JSON.stringify(bannersWithProcessedImages));
    } catch (e) {
      logger.error('Redis 写入轮播公开列表失败', { err: e });
    }
    return adminResult(200, bannersWithProcessedImages);
  } catch (error) {
    logger.error('getPublicBannersList failed', { err: error });
    return adminResult(500, { error: '获取轮播图列表服务暂时不可用' });
  }
}

async function getAllBannersAdmin() {
  try {
    const cache = await redisClient.get(REDIS_BANNERS_ALL_KEY);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }
    const [banners] = await db.query(
      'SELECT id, title, image_url, link_url, sort_order, status FROM banners ORDER BY sort_order ASC'
    );
    const bannersWithProcessedImages = (banners || []).map((banner) =>
      processObjectImages(banner, ['image_url'])
    );
    try {
      await redisClient.set(REDIS_BANNERS_ALL_KEY, JSON.stringify(bannersWithProcessedImages));
    } catch (e) {
      logger.error('Redis 写入轮播全量列表失败', { err: e });
    }
    return adminResult(200, bannersWithProcessedImages);
  } catch (error) {
    logger.error('getAllBannersAdmin failed', { err: error });
    return adminResult(500, { error: '获取所有轮播图服务暂时不可用' });
  }
}

async function createBannerAdmin(body) {
  const { title, image_url, link_url, sort_order } = body || {};
  const v = validateBannerFields(title, image_url, sort_order);
  if (!v.ok) return v;

  try {
    const [result] = await db.query(
      'INSERT INTO banners (title, image_url, link_url, sort_order) VALUES (?, ?, ?, ?)',
      [v.title, image_url, link_url || null, v.cleanSortOrder]
    );
    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [result.insertId]);
    const processedBanner = processObjectImages(banner[0], ['image_url']);
    await invalidateBannerCaches();
    return adminResult(200, processedBanner);
  } catch (error) {
    logger.error('createBannerAdmin failed', { err: error });
    return adminResult(500, { error: '添加轮播图服务暂时不可用' });
  }
}

async function updateBannerAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的轮播图ID' });

  const { title, image_url, link_url, sort_order, status } = body || {};
  const v = validateBannerFields(title, image_url, sort_order);
  if (!v.ok) return v;

  const validStatuses = ['active', 'inactive'];
  const cleanStatus = validStatuses.includes(status) ? status : 'active';

  try {
    await db.query(
      'UPDATE banners SET title = ?, image_url = ?, link_url = ?, sort_order = ?, status = ? WHERE id = ?',
      [v.title, image_url, link_url || null, v.cleanSortOrder, cleanStatus, id]
    );
    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [id]);
    const processedBanner = processObjectImages(banner[0], ['image_url']);
    await invalidateBannerCaches();
    return adminResult(200, processedBanner);
  } catch (error) {
    logger.error('updateBannerAdmin failed', { err: error });
    return adminResult(500, { error: '更新轮播图服务暂时不可用' });
  }
}

async function deleteBannerAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的轮播图ID' });

  try {
    await db.query('DELETE FROM banners WHERE id = ?', [id]);
    await invalidateBannerCaches();
    return adminResult(200, { message: '删除成功' });
  } catch (error) {
    logger.error('deleteBannerAdmin failed', { err: error });
    return adminResult(500, { error: '删除轮播图服务暂时不可用' });
  }
}

module.exports = {
  REDIS_BANNERS_LIST_KEY,
  REDIS_BANNERS_ALL_KEY,
  getPublicBannersList,
  getAllBannersAdmin,
  createBannerAdmin,
  updateBannerAdmin,
  deleteBannerAdmin,
};
