const db = require('../db');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');

const REDIS_PHYSICAL_CATEGORIES_LIST_KEY = 'physical_categories:list';

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

async function clearPhysicalCategoriesCache() {
  try {
    const n = await redisClient.scanDelByPattern(`${REDIS_PHYSICAL_CATEGORIES_LIST_KEY}*`);
    if (n > 0) {
      logger.info('physical categories cache cleared', { keys: n });
    }
  } catch (error) {
    logger.error('clearPhysicalCategoriesCache failed', { err: error });
  }
}

async function getPublicPhysicalCategoriesList(query) {
  const { page = 1, limit = 20, sort = 'created_at', order = 'desc' } = query || {};

  const cleanPage = Math.max(1, parseInt(page, 10) || 1);
  const cleanLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const cleanSort = ['id', 'title', 'count', 'created_at', 'updated_at'].includes(sort) ? sort : 'created_at';
  const cleanOrder = ['asc', 'desc'].includes(String(order).toLowerCase()) ? String(order).toLowerCase() : 'desc';

  const offset = (cleanPage - 1) * cleanLimit;

  const cacheKey =
    cleanPage === 1 && sort === 'created_at' && order === 'desc'
      ? REDIS_PHYSICAL_CATEGORIES_LIST_KEY
      : `${REDIS_PHYSICAL_CATEGORIES_LIST_KEY}:${cleanPage}:${cleanLimit}:${cleanSort}:${cleanOrder}`;

  try {
    const cache = await redisClient.get(cacheKey);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }

    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM physical_categories');

    const [rows] = await db.query(
      `
      SELECT 
        pc.id,
        pc.title,
        pc.image,
        pc.description,
        pc.created_at,
        pc.updated_at,
        COALESCE(COUNT(r.id), 0) as count
      FROM physical_categories pc
      LEFT JOIN rights r ON pc.id = r.category_id
      GROUP BY pc.id, pc.title, pc.image, pc.description, pc.created_at, pc.updated_at
      ORDER BY ${cleanSort} ${cleanOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `,
      [cleanLimit, offset]
    );

    if (!rows || !Array.isArray(rows)) {
      return adminResult(200, {
        data: [],
        pagination: {
          total: 0,
          page: cleanPage,
          limit: cleanLimit,
          totalPages: 0,
        },
      });
    }

    const categoriesWithProcessedImages = rows.map((category) => processObjectImages(category, ['image']));

    const result = {
      data: categoriesWithProcessedImages,
      pagination: {
        total: parseInt(total, 10),
        page: cleanPage,
        limit: cleanLimit,
        totalPages: Math.ceil(parseInt(total, 10) / cleanLimit),
      },
    };

    if (cleanPage === 1 && sort === 'created_at' && order === 'desc') {
      await redisClient.setEx(REDIS_PHYSICAL_CATEGORIES_LIST_KEY, 604800, JSON.stringify(result));
    }

    return adminResult(200, result);
  } catch (error) {
    logger.error('getPublicPhysicalCategoriesList failed', { err: error });
    return adminResult(500, { error: '获取实物分类数据服务暂时不可用' });
  }
}

async function createPhysicalCategoryAdmin(body) {
  const { title, image, description } = body || {};

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return adminResult(400, { error: '分类名称不能为空' });
  }
  if (title.length > 100) {
    return adminResult(400, { error: '分类名称长度不能超过100个字符' });
  }
  if (description && description.length > 1000) {
    return adminResult(400, { error: '描述长度不能超过1000个字符' });
  }

  const cleanTitle = title.trim();
  const cleanDescription = description ? description.trim() : '';

  try {
    const [existing] = await db.query('SELECT id FROM physical_categories WHERE title = ?', [cleanTitle]);
    if (existing && existing.length > 0) {
      return adminResult(400, { error: '分类名称已存在' });
    }

    const [result] = await db.query('INSERT INTO physical_categories (title, image, description) VALUES (?, ?, ?)', [
      cleanTitle,
      image,
      cleanDescription,
    ]);

    const [newCategory] = await db.query(
      `
      SELECT 
        pc.id,
        pc.title,
        pc.image,
        pc.description,
        pc.created_at,
        pc.updated_at,
        COALESCE(COUNT(r.id), 0) as count
      FROM physical_categories pc
      LEFT JOIN rights r ON pc.id = r.category_id
      WHERE pc.id = ?
      GROUP BY pc.id, pc.title, pc.image, pc.description, pc.created_at, pc.updated_at
    `,
      [result.insertId]
    );

    if (!newCategory || newCategory.length === 0) {
      return adminResult(500, { error: '创建分类失败' });
    }

    const processedCategory = processObjectImages(newCategory[0], ['image']);
    await clearPhysicalCategoriesCache();
    return adminResult(200, processedCategory);
  } catch (error) {
    logger.error('createPhysicalCategoryAdmin failed', { err: error });
    return adminResult(500, { error: '创建实物分类服务暂时不可用' });
  }
}

async function updatePhysicalCategoryAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的分类ID' });

  const { title, image, description } = body || {};

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return adminResult(400, { error: '分类名称不能为空' });
  }
  if (title.length > 100) {
    return adminResult(400, { error: '分类名称长度不能超过100个字符' });
  }
  if (description && description.length > 1000) {
    return adminResult(400, { error: '描述长度不能超过1000个字符' });
  }

  const cleanTitle = title.trim();
  const cleanDescription = description ? description.trim() : '';

  try {
    const [existing] = await db.query('SELECT id, title FROM physical_categories WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return adminResult(404, { error: '分类不存在' });
    }

    const [duplicate] = await db.query('SELECT id FROM physical_categories WHERE title = ? AND id != ?', [
      cleanTitle,
      id,
    ]);
    if (duplicate && duplicate.length > 0) {
      return adminResult(400, { error: '分类名称已存在' });
    }

    await db.query(
      'UPDATE physical_categories SET title = ?, image = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [cleanTitle, image, cleanDescription, id]
    );

    const [updatedCategory] = await db.query(
      `
      SELECT 
        pc.id,
        pc.title,
        pc.image,
        pc.description,
        pc.created_at,
        pc.updated_at,
        COALESCE(COUNT(r.id), 0) as count
      FROM physical_categories pc
      LEFT JOIN rights r ON pc.id = r.category_id
      WHERE pc.id = ?
      GROUP BY pc.id, pc.title, pc.image, pc.description, pc.created_at, pc.updated_at
    `,
      [id]
    );

    if (!updatedCategory || updatedCategory.length === 0) {
      return adminResult(500, { error: '更新分类失败' });
    }

    const processedCategory = processObjectImages(updatedCategory[0], ['image']);
    await clearPhysicalCategoriesCache();
    return adminResult(200, processedCategory);
  } catch (error) {
    logger.error('updatePhysicalCategoryAdmin failed', { err: error });
    return adminResult(500, { error: '更新实物分类服务暂时不可用' });
  }
}

async function deletePhysicalCategoryAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的分类ID' });

  try {
    const [existing] = await db.query('SELECT id, title FROM physical_categories WHERE id = ?', [id]);
    if (!existing || existing.length === 0) {
      return adminResult(404, { error: '分类不存在' });
    }

    await db.query('DELETE FROM physical_categories WHERE id = ?', [id]);
    await clearPhysicalCategoriesCache();

    return adminResult(200, {
      message: '删除成功',
      deletedCategory: {
        id: existing[0].id,
        title: existing[0].title,
      },
    });
  } catch (error) {
    logger.error('deletePhysicalCategoryAdmin failed', { err: error });
    return adminResult(500, { error: '删除实物分类服务暂时不可用' });
  }
}

async function getPublicPhysicalCategoryDetail(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的分类ID' });

  try {
    const [categories] = await db.query(
      `
      SELECT 
        pc.id,
        pc.title,
        pc.image,
        pc.description,
        pc.created_at,
        pc.updated_at,
        COALESCE(COUNT(r.id), 0) as count
      FROM physical_categories pc
      LEFT JOIN rights r ON pc.id = r.category_id
      WHERE pc.id = ?
      GROUP BY pc.id, pc.title, pc.image, pc.description, pc.created_at, pc.updated_at
    `,
      [id]
    );

    if (!categories || categories.length === 0) {
      return adminResult(404, { error: '分类不存在' });
    }

    const processedCategory = processObjectImages(categories[0], ['image']);
    return adminResult(200, processedCategory);
  } catch (error) {
    logger.error('getPublicPhysicalCategoryDetail failed', { err: error });
    return adminResult(500, { error: '获取实物分类详情服务暂时不可用' });
  }
}

module.exports = {
  getPublicPhysicalCategoriesList,
  createPhysicalCategoryAdmin,
  updatePhysicalCategoryAdmin,
  deletePhysicalCategoryAdmin,
  getPublicPhysicalCategoryDetail,
};
