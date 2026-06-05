const db = require('../db');
const logger = require('../utils/logger');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const { parseMoney, buildRightDiscountPricingByUser } = require('../utils/rightDiscountPricing');

const REDIS_RIGHTS_LIST_KEY = 'rights:list';
const REDIS_RIGHT_DETAIL_KEY_PREFIX = 'rights:detail:';
const REDIS_PHYSICAL_CATEGORIES_LIST_KEY = 'physical_categories:list';

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

function parsePositiveIntId(raw) {
  const id = parseInt(String(raw), 10);
  if (Number.isNaN(id) || id <= 0) return null;
  return id;
}

async function clearRightsCache() {
  try {
    const n = await redisClient.scanDelByPattern(`${REDIS_RIGHTS_LIST_KEY}*`);
    if (n > 0) {
      logger.info('rights cache cleared', { keys: n });
    }
  } catch (error) {
    logger.error('clearRightsCache failed', { err: error });
  }
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

async function ensureDiscountSchema(connection) {
  try {
    const [cols] = await connection.query(
      `SELECT COUNT(*) AS cnt
             FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'rights'
               AND COLUMN_NAME = 'discount_price'`
    );
    const exists = cols && cols[0] && cols[0].cnt > 0;
    if (!exists) {
      await connection.query('ALTER TABLE rights ADD COLUMN discount_price DECIMAL(10,2) NULL DEFAULT NULL');
    }
  } catch (e) {
    logger.error('检查/新增 rights.discount_price 字段失败', { err: e });
    throw e;
  }

  try {
    await connection.query(`
            CREATE TABLE IF NOT EXISTS right_discount_eligibles (
                id INT PRIMARY KEY AUTO_INCREMENT,
                right_id INT NOT NULL,
                digital_artwork_id INT NOT NULL,
                UNIQUE KEY uniq_right_digital (right_id, digital_artwork_id),
                INDEX idx_right_id (right_id),
                CONSTRAINT fk_rde_right FOREIGN KEY (right_id) REFERENCES rights(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
  } catch (e) {
    logger.error('创建 right_discount_eligibles 表失败', { err: e });
    throw e;
  }
}

async function getPublicRightsList(query) {
  const { page = 1, limit = 20, status, category_id, sort = 'created_at', order = 'desc' } = query || {};

  const cleanPage = Math.max(1, parseInt(page, 10) || 1);
  const cleanLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const cleanSort = ['id', 'title', 'price', 'created_at', 'updated_at'].includes(sort) ? sort : 'created_at';
  const cleanOrder = ['asc', 'desc'].includes(String(order).toLowerCase()) ? String(order).toLowerCase() : 'desc';
  const cleanStatus = status && ['onsale', 'sold', 'draft'].includes(status) ? status : null;
  const cleanCategoryId = category_id && !Number.isNaN(parseInt(category_id, 10)) ? parseInt(category_id, 10) : null;

  const offset = (cleanPage - 1) * cleanLimit;

  const cacheKey =
    cleanPage === 1 && !cleanStatus && !cleanCategoryId && sort === 'created_at' && order === 'desc'
      ? REDIS_RIGHTS_LIST_KEY
      : `${REDIS_RIGHTS_LIST_KEY}:${cleanPage}:${cleanLimit}:${cleanStatus || 'all'}:${cleanCategoryId || 'all'}:${cleanSort}:${cleanOrder}`;

  try {
    const cache = await redisClient.get(cacheKey);
    if (cache) {
      return adminResult(200, JSON.parse(cache));
    }

    let whereClause = 'WHERE 1=1';
    const params = [];

    if (cleanStatus) {
      whereClause += ' AND r.status = ?';
      params.push(cleanStatus);
    }
    if (cleanCategoryId) {
      whereClause += ' AND r.category_id = ?';
      params.push(cleanCategoryId);
    }

    const [[{ total }]] = await db.query(
      `
            SELECT COUNT(*) as total 
            FROM rights r 
            ${whereClause}
        `,
      params
    );

    const [rows] = await db.query(
      `
            SELECT 
                r.id,
                r.title,
                r.status,
                r.price,
                r.discount_price,
                r.original_price,
                r.period,
                r.total_count,
                r.remaining_count,
                r.description,
                r.category_id,
                r.artist_id,
                r.created_at,
                r.updated_at,
                c.title as category_title,
                a.id as artist_id,
                a.name as artist_name,
                a.avatar as artist_avatar,
                r.rich_text
            FROM rights r
            LEFT JOIN physical_categories c ON r.category_id = c.id
            LEFT JOIN artists a ON r.artist_id = a.id
            ${whereClause}
            ORDER BY r.${cleanSort} ${cleanOrder.toUpperCase()}
            LIMIT ? OFFSET ?
        `,
      [...params, cleanLimit, offset]
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

    const rightIds = rows.map((row) => row.id);
    const [allImages] = await db.query(
      `
            SELECT right_id, image_url 
            FROM right_images 
            WHERE right_id IN (?)
            ORDER BY right_id, id
        `,
      [rightIds]
    );

    const imagesMap = new Map();
    allImages.forEach((img) => {
      if (!imagesMap.has(img.right_id)) {
        imagesMap.set(img.right_id, []);
      }
      imagesMap.get(img.right_id).push(img.image_url);
    });

    const rightsWithImages = rows.map((right) => ({
      ...right,
      images: imagesMap.get(right.id) || [],
      artist: right.artist_id
        ? {
            id: right.artist_id,
            name: right.artist_name,
            avatar: right.artist_avatar,
          }
        : null,
    }));

    const result = {
      data: rightsWithImages,
      pagination: {
        total: parseInt(total, 10),
        page: cleanPage,
        limit: cleanLimit,
        totalPages: Math.ceil(parseInt(total, 10) / cleanLimit),
      },
    };

    if (cleanPage === 1 && !cleanStatus && !cleanCategoryId && sort === 'created_at' && order === 'desc') {
      await redisClient.setEx(REDIS_RIGHTS_LIST_KEY, 604800, JSON.stringify(result));
    }

    return adminResult(200, result);
  } catch (error) {
    logger.error('getPublicRightsList failed', { err: error });
    return adminResult(500, { error: '获取版权实物列表服务暂时不可用' });
  }
}

function validateCreateRightBody(body) {
  const {
    title,
    status,
    price,
    discount_price,
    originalPrice,
    period,
    totalCount,
    remainingCount,
    description,
    images,
  } = body || {};

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return adminResult(400, { error: '标题不能为空' });
  }
  if (title.length > 200) {
    return adminResult(400, { error: '标题长度不能超过200个字符' });
  }
  if (!status || !['onsale', 'sold', 'draft'].includes(status)) {
    return adminResult(400, { error: '状态必须是 onsale、sold 或 draft' });
  }
  if (!price || Number.isNaN(parseFloat(price)) || parseFloat(price) < 0) {
    return adminResult(400, { error: '价格必须是有效的正数' });
  }
  if (originalPrice && (Number.isNaN(parseFloat(originalPrice)) || parseFloat(originalPrice) < 0)) {
    return adminResult(400, { error: '原价必须是有效的正数' });
  }
  if (discount_price && (Number.isNaN(parseFloat(discount_price)) || parseFloat(discount_price) < 0)) {
    return adminResult(400, { error: '优惠价必须是有效的正数' });
  }
  if (totalCount && (Number.isNaN(parseInt(totalCount, 10)) || parseInt(totalCount, 10) < 0)) {
    return adminResult(400, { error: '总数量必须是有效的正整数' });
  }
  if (remainingCount && (Number.isNaN(parseInt(remainingCount, 10)) || parseInt(remainingCount, 10) < 0)) {
    return adminResult(400, { error: '剩余数量必须是有效的正整数' });
  }
  if (description && description.length > 2000) {
    return adminResult(400, { error: '描述长度不能超过2000个字符' });
  }
  if (images && !Array.isArray(images)) {
    return adminResult(400, { error: '图片必须是数组格式' });
  }
  return null;
}

async function createRightAdmin(body) {
  const v = validateCreateRightBody(body);
  if (v) return v;

  const {
    title,
    status,
    price,
    discount_price,
    originalPrice,
    period,
    totalCount,
    remainingCount,
    description,
    images,
    category_id,
    artist_id,
    rich_text,
    eligible_digital_artwork_ids,
  } = body || {};

  let rightId;
  try {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await ensureDiscountSchema(connection);
      const [insertResult] = await connection.query(
        'INSERT INTO rights (title, status, price, discount_price, original_price, period, total_count, remaining_count, description, category_id, artist_id, rich_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          title.trim(),
          status,
          parseFloat(price),
          discount_price ? parseFloat(discount_price) : null,
          originalPrice ? parseFloat(originalPrice) : null,
          period,
          totalCount ? parseInt(totalCount, 10) : null,
          remainingCount ? parseInt(remainingCount, 10) : null,
          description ? description.trim() : '',
          category_id,
          artist_id || null,
          rich_text,
        ]
      );
      rightId = insertResult.insertId;

      if (images && images.length > 0) {
        const imageValues = images.map((image) => [rightId, image]);
        await connection.query('INSERT INTO right_images (right_id, image_url) VALUES ?', [imageValues]);
      }

      if (eligible_digital_artwork_ids && Array.isArray(eligible_digital_artwork_ids) && eligible_digital_artwork_ids.length > 0) {
        const values = eligible_digital_artwork_ids
          .filter((id) => !Number.isNaN(parseInt(id, 10)))
          .map((id) => [rightId, parseInt(id, 10)]);
        if (values.length > 0) {
          await connection.query('INSERT IGNORE INTO right_discount_eligibles (right_id, digital_artwork_id) VALUES ?', [values]);
        }
      }

      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    const [newRight] = await db.query(
      `
                SELECT 
                    r.id,
                    r.title,
                    r.status,
                    r.price,
                    r.discount_price,
                    r.original_price,
                    r.period,
                    r.total_count,
                    r.remaining_count,
                    r.description,
                    r.category_id,
                    r.artist_id,
                    r.rich_text,
                    r.created_at,
                    r.updated_at,
                    c.title as category_title,
                    a.id as artist_id,
                    a.name as artist_name,
                    a.avatar as artist_avatar
                FROM rights r
                LEFT JOIN physical_categories c ON r.category_id = c.id
                LEFT JOIN artists a ON r.artist_id = a.id
                WHERE r.id = ?
            `,
      [rightId]
    );

    if (!newRight || newRight.length === 0) {
      return adminResult(500, { error: '创建版权实物失败' });
    }

    const [rightImages] = await db.query('SELECT image_url FROM right_images WHERE right_id = ? ORDER BY id', [rightId]);
    const [eligibleList] = await db.query('SELECT digital_artwork_id FROM right_discount_eligibles WHERE right_id = ?', [rightId]);

    const result = {
      ...newRight[0],
      images: rightImages.map((img) => img.image_url || ''),
      eligible_digital_artwork_ids: (eligibleList || []).map((x) => x.digital_artwork_id),
      artist: newRight[0].artist_id
        ? {
            id: newRight[0].artist_id,
            name: newRight[0].artist_name,
            avatar: newRight[0].artist_avatar,
          }
        : null,
    };

    await redisClient.del(REDIS_RIGHTS_LIST_KEY);
    await clearPhysicalCategoriesCache();
    return adminResult(200, result);
  } catch (error) {
    logger.error('createRightAdmin failed', { err: error });
    return adminResult(500, { error: '创建版权实物失败' });
  }
}

function validateUpdateRightBody(body) {
  const {
    title,
    status,
    price,
    discount_price,
    originalPrice,
    period,
    totalCount,
    remainingCount,
    description,
    images,
  } = body || {};

  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return adminResult(400, { error: '标题不能为空' });
  }
  if (title.length > 200) {
    return adminResult(400, { error: '标题长度不能超过200个字符' });
  }
  if (!status || !['onsale', 'soldout', 'upcoming', 'sold', 'draft'].includes(status)) {
    return adminResult(400, { error: '状态必须是 onsale、soldout、upcoming、sold 或 draft' });
  }
  if (!price || Number.isNaN(parseFloat(price)) || parseFloat(price) < 0) {
    return adminResult(400, { error: '价格必须是有效的正数' });
  }
  if (discount_price && (Number.isNaN(parseFloat(discount_price)) || parseFloat(discount_price) < 0)) {
    return adminResult(400, { error: '优惠价必须是有效的正数' });
  }
  if (originalPrice && (Number.isNaN(parseFloat(originalPrice)) || parseFloat(originalPrice) < 0)) {
    return adminResult(400, { error: '原价必须是有效的正数' });
  }
  if (totalCount && (Number.isNaN(parseInt(totalCount, 10)) || parseInt(totalCount, 10) < 0)) {
    return adminResult(400, { error: '总数量必须是有效的正整数' });
  }
  if (remainingCount && (Number.isNaN(parseInt(remainingCount, 10)) || parseInt(remainingCount, 10) < 0)) {
    return adminResult(400, { error: '剩余数量必须是有效的正整数' });
  }
  if (description && description.length > 2000) {
    return adminResult(400, { error: '描述长度不能超过2000个字符' });
  }
  if (images && !Array.isArray(images)) {
    return adminResult(400, { error: '图片必须是数组格式' });
  }
  return null;
}

async function updateRightAdmin(rawId, body) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的版权实物ID' });

  const v = validateUpdateRightBody(body);
  if (v) return v;

  const {
    title,
    status,
    price,
    discount_price,
    originalPrice,
    period,
    totalCount,
    remainingCount,
    description,
    images,
    category_id,
    artist_id,
    rich_text,
    eligible_digital_artwork_ids,
  } = body || {};

  try {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await ensureDiscountSchema(connection);
      const [existing] = await connection.query('SELECT id FROM rights WHERE id = ?', [id]);
      if (!existing || existing.length === 0) {
        await connection.rollback();
        return adminResult(404, { error: '版权实物不存在' });
      }

      await connection.query(
        'UPDATE rights SET title = ?, status = ?, price = ?, discount_price = ?, original_price = ?, period = ?, total_count = ?, remaining_count = ?, description = ?, category_id = ?, artist_id = ?, rich_text = ?, updated_at = NOW() WHERE id = ?',
        [
          title.trim(),
          status,
          parseFloat(price),
          discount_price ? parseFloat(discount_price) : null,
          originalPrice ? parseFloat(originalPrice) : null,
          period,
          totalCount ? parseInt(totalCount, 10) : null,
          remainingCount ? parseInt(remainingCount, 10) : null,
          description ? description.trim() : '',
          category_id,
          artist_id || null,
          rich_text,
          id,
        ]
      );

      await connection.query('DELETE FROM right_images WHERE right_id = ?', [id]);
      if (images && images.length > 0) {
        const imageValues = images.map((image) => [id, image]);
        await connection.query('INSERT INTO right_images (right_id, image_url) VALUES ?', [imageValues]);
      }

      await connection.query('DELETE FROM right_discount_eligibles WHERE right_id = ?', [id]);
      if (eligible_digital_artwork_ids && Array.isArray(eligible_digital_artwork_ids) && eligible_digital_artwork_ids.length > 0) {
        const values = eligible_digital_artwork_ids
          .filter((did) => !Number.isNaN(parseInt(did, 10)))
          .map((did) => [id, parseInt(did, 10)]);
        if (values.length > 0) {
          await connection.query('INSERT IGNORE INTO right_discount_eligibles (right_id, digital_artwork_id) VALUES ?', [values]);
        }
      }

      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    const [updatedRight] = await db.query(
      `
                SELECT 
                    r.id,
                    r.title,
                    r.status,
                    r.price,
                    r.discount_price,
                    r.original_price,
                    r.period,
                    r.total_count,
                    r.remaining_count,
                    r.description,
                    r.category_id,
                    r.artist_id,
                    r.rich_text,
                    r.created_at,
                    r.updated_at,
                    c.title as category_title,
                    a.id as artist_id,
                    a.name as artist_name,
                    a.avatar as artist_avatar
                FROM rights r
                LEFT JOIN physical_categories c ON r.category_id = c.id
                LEFT JOIN artists a ON r.artist_id = a.id
                WHERE r.id = ?
            `,
      [id]
    );

    if (!updatedRight || updatedRight.length === 0) {
      return adminResult(500, { error: '更新版权实物失败' });
    }

    const [rightImages] = await db.query('SELECT image_url FROM right_images WHERE right_id = ? ORDER BY id', [id]);
    const [eligibleList] = await db.query('SELECT digital_artwork_id FROM right_discount_eligibles WHERE right_id = ?', [id]);

    const result = {
      ...updatedRight[0],
      images: rightImages.map((img) => img.image_url || ''),
      eligible_digital_artwork_ids: (eligibleList || []).map((x) => x.digital_artwork_id),
      artist: updatedRight[0].artist_id
        ? {
            id: updatedRight[0].artist_id,
            name: updatedRight[0].artist_name,
            avatar: updatedRight[0].artist_avatar,
          }
        : null,
    };

    await clearRightsCache();
    await redisClient.del(REDIS_RIGHT_DETAIL_KEY_PREFIX + id);
    await clearPhysicalCategoriesCache();
    return adminResult(200, result);
  } catch (error) {
    logger.error('updateRightAdmin failed', { err: error });
    return adminResult(500, { error: '更新版权实物失败' });
  }
}

async function deleteRightAdmin(rawId) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的版权实物ID' });

  let deletedMeta;
  try {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const [existing] = await connection.query('SELECT id, title FROM rights WHERE id = ?', [id]);
      if (!existing || existing.length === 0) {
        await connection.rollback();
        return adminResult(404, { error: '版权实物不存在' });
      }
      deletedMeta = { id: existing[0].id, title: existing[0].title };

      await connection.query('DELETE FROM cart_items WHERE right_id = ?', [id]);
      await connection.query('DELETE FROM order_items WHERE right_id = ?', [id]);
      await connection.query('DELETE FROM right_images WHERE right_id = ?', [id]);
      await connection.query('DELETE FROM rights WHERE id = ?', [id]);
      await connection.commit();
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }

    await clearRightsCache();
    await redisClient.del(REDIS_RIGHT_DETAIL_KEY_PREFIX + id);
    await clearPhysicalCategoriesCache();

    return adminResult(200, {
      message: '删除成功',
      deletedRight: deletedMeta,
    });
  } catch (error) {
    logger.error('deleteRightAdmin failed', { err: error });
    return adminResult(500, { error: '删除版权实物失败' });
  }
}

function attachRightDiscountForUser(result, userId) {
  if (!userId) return result;
  return buildRightDiscountPricingByUser(userId, { [result.id]: result }).then((pricingMap) => {
    const pricing = pricingMap[result.id] || {};
    return {
      ...result,
      owned_eligible_digital_artwork_ids: pricing.owned_eligible_digital_artwork_ids || [],
      has_discount: pricing.has_discount ?? parseMoney(result.discount_price) > 0,
      discount_eligible: pricing.discount_eligible ?? false,
      effective_price: pricing.effective_price ?? parseMoney(result.price),
    };
  });
}

async function getPublicRightDetail(rawId, userId = null) {
  const id = parsePositiveIntId(rawId);
  if (!id) return adminResult(400, { error: '无效的版权实物ID' });

  try {
    let result = null;
    const cache = await redisClient.get(REDIS_RIGHT_DETAIL_KEY_PREFIX + id);
    if (cache) {
      result = JSON.parse(cache);
    }

    if (!result) {
      const [rows] = await db.query(
        `
            SELECT 
                r.id,
                r.title,
                r.status,
                r.price,
                r.discount_price,
                r.original_price,
                r.period,
                r.total_count,
                r.remaining_count,
                r.description,
                r.category_id,
                r.artist_id,
                r.rich_text,
                r.created_at,
                r.updated_at,
                c.title as category_title,
                a.id as artist_id,
                a.name as artist_name,
                a.avatar as artist_avatar
            FROM rights r
            LEFT JOIN physical_categories c ON r.category_id = c.id
            LEFT JOIN artists a ON r.artist_id = a.id
            WHERE r.id = ?
        `,
        [id]
      );

      if (!rows || rows.length === 0) {
        return adminResult(404, { error: '版权实物不存在' });
      }

      const right = processObjectImages(rows[0], ['image']);
      const [images] = await db.query('SELECT image_url FROM right_images WHERE right_id = ? ORDER BY id', [right.id]);
      const [eligibleList] = await db.query('SELECT digital_artwork_id FROM right_discount_eligibles WHERE right_id = ?', [right.id]);

      result = {
        ...right,
        rich_text: right.rich_text,
        images: images.map((img) => processObjectImages(img, ['image_url']).image_url),
        eligible_digital_artwork_ids: (eligibleList || []).map((x) => String(x.digital_artwork_id)),
        category: {
          id: right.category_id,
          title: right.category_title,
        },
        artist: right.artist_id
          ? {
              id: right.artist_id,
              name: right.artist_name,
              avatar: right.artist_avatar,
            }
          : null,
      };

      await redisClient.setEx(REDIS_RIGHT_DETAIL_KEY_PREFIX + id, 604800, JSON.stringify(result));
    }

    if (userId) {
      result = await attachRightDiscountForUser(result, userId);
    }

    return adminResult(200, result);
  } catch (error) {
    logger.error('getPublicRightDetail failed', { err: error });
    return adminResult(500, { error: '获取版权实物详情失败' });
  }
}

module.exports = {
  getPublicRightsList,
  createRightAdmin,
  updateRightAdmin,
  deleteRightAdmin,
  getPublicRightDetail,
};
