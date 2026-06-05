const db = require('../db');
const logger = require('../utils/logger');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';

function adminResult(status, body) {
  return { ok: status >= 200 && status < 400, status, body };
}

/**
 * 将 favorites.item_id 从 INT 等升级为 VARCHAR(64)，以支持外部同步的 goods_id（长整型字符串）。
 */
let favoritesSchemaReady = false;

async function ensureFavoritesSchema() {
  if (favoritesSchemaReady) return;
  try {
    const [rows] = await db.query(
      `
      SELECT DATA_TYPE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'favorites'
        AND COLUMN_NAME = 'item_id'
      `
    );
    if (!rows.length) {
      favoritesSchemaReady = true;
      return;
    }
    const t = String(rows[0].DATA_TYPE || '').toLowerCase();
    if (t === 'int' || t === 'integer' || t === 'bigint' || t === 'mediumint' || t === 'smallint') {
      await db.query('ALTER TABLE favorites MODIFY item_id VARCHAR(64) NOT NULL');
      logger.info('[favorites] item_id 已升级为 VARCHAR(64)，以支持外部数字艺术品 goods_id');
    }
    favoritesSchemaReady = true;
  } catch (err) {
    logger.warn('[favorites] ensureFavoritesSchema', { message: err.message });
    favoritesSchemaReady = true;
  }
}

/** 解析数字艺术品收藏用的 item_id：仅数字字符串，与 digital_artworks / digital_artworks_external 的 id 一致 */
function parseDigitalArtItemId(raw) {
  if (raw === undefined || raw === null) return { error: '无效的物品ID' };
  let s;
  if (typeof raw === 'string') {
    s = raw.trim();
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > Number.MAX_SAFE_INTEGER || raw < Number.MIN_SAFE_INTEGER) {
      return {
        error: '数字艺术品ID请使用字符串传递，避免大整数精度丢失',
      };
    }
    s = String(Math.trunc(raw));
  } else {
    return { error: '无效的物品ID' };
  }
  if (!/^\d+$/.test(s) || s.length < 1 || s.length > 64) {
    return { error: '无效的物品ID' };
  }
  return { id: s };
}

const VALID_FAVORITE_TYPES = ['artwork', 'digital_art', 'copyright_item'];

function parseFavoriteItemRef(itemType, rawItemId) {
  if (!VALID_FAVORITE_TYPES.includes(itemType)) {
    return { error: '无效的收藏类型' };
  }

  if (itemType === 'digital_art') {
    const decoded = typeof rawItemId === 'string' ? decodeURIComponent(rawItemId) : rawItemId;
    const parsed = parseDigitalArtItemId(decoded);
    if (parsed.error) return { error: parsed.error };
    return { itemType, itemId: parsed.id };
  }

  const n = parseInt(rawItemId, 10);
  if (Number.isNaN(n) || n <= 0) {
    return { error: '无效的物品ID' };
  }
  return { itemType, itemId: n };
}

async function validateItemExists(itemId, itemType, connection = null) {
  try {
    const q = connection ? connection.query.bind(connection) : db.query;
    switch (itemType) {
      case 'artwork': {
        const id = parseInt(itemId, 10);
        if (Number.isNaN(id) || id <= 0) return false;
        const [result] = await q('SELECT id FROM original_artworks WHERE id = ?', [id]);
        return result && result.length > 0;
      }
      case 'digital_art': {
        const sid = String(itemId).trim();
        if (!sid) return false;
        const [legacy] = await q('SELECT id FROM digital_artworks WHERE id = ?', [sid]);
        if (legacy && legacy.length > 0) return true;
        const [ext] = await q(`SELECT id FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} WHERE id = ?`, [sid]);
        return ext && ext.length > 0;
      }
      case 'copyright_item': {
        const id = parseInt(itemId, 10);
        if (Number.isNaN(id) || id <= 0) return false;
        const [result] = await q('SELECT id FROM rights WHERE id = ?', [id]);
        return result && result.length > 0;
      }
      default:
        return false;
    }
  } catch (err) {
    logger.error('验证物品存在性失败', { err });
    return false;
  }
}

async function addFavorite(userId, body) {
  const { itemId, itemType } = body || {};

  if (!itemId || !itemType) {
    return adminResult(400, { error: '缺少必要参数' });
  }

  const parsedRef = parseFavoriteItemRef(itemType, itemId);
  if (parsedRef.error) {
    return adminResult(400, { error: parsedRef.error });
  }
  const cleanItemId = parsedRef.itemId;

  if (!userId || Number.isNaN(parseInt(userId, 10)) || parseInt(userId, 10) <= 0) {
    return adminResult(400, { error: '无效的用户ID' });
  }

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const itemExists = await validateItemExists(cleanItemId, itemType, connection);
      if (!itemExists) {
        await connection.rollback();
        connection.release();
        return adminResult(404, { error: '要收藏的物品不存在' });
      }

      const checkSql = 'SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
      const [existing] = await connection.query(checkSql, [userId, cleanItemId, itemType]);

      if (existing && existing.length > 0) {
        await connection.rollback();
        connection.release();
        return adminResult(400, { error: '已经收藏过该物品' });
      }

      const sql = 'INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)';
      await connection.query(sql, [userId, cleanItemId, itemType]);

      await connection.commit();
      connection.release();

      return adminResult(200, { success: true });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    logger.error('添加收藏失败', { err });
    return adminResult(500, { error: '添加收藏服务暂时不可用' });
  }
}

async function removeFavorite(userId, itemType, rawItemId) {
  if (!userId || Number.isNaN(parseInt(userId, 10)) || parseInt(userId, 10) <= 0) {
    return adminResult(400, { error: '无效的用户ID' });
  }

  const parsedRef = parseFavoriteItemRef(itemType, rawItemId);
  if (parsedRef.error) {
    return adminResult(400, { error: parsedRef.error });
  }
  const cleanItemId = parsedRef.itemId;

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const sql = 'DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
      const [result] = await connection.query(sql, [userId, cleanItemId, itemType]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return adminResult(404, { error: '未找到该收藏记录' });
      }

      await connection.commit();
      connection.release();

      return adminResult(200, { success: true });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    logger.error('取消收藏失败', { err });
    return adminResult(500, { error: '取消收藏服务暂时不可用' });
  }
}

async function getFavoriteStatus(userId, itemType, rawItemId) {
  if (!userId || Number.isNaN(parseInt(userId, 10)) || parseInt(userId, 10) <= 0) {
    return adminResult(400, { error: '无效的用户ID' });
  }

  const parsedRef = parseFavoriteItemRef(itemType, rawItemId);
  if (parsedRef.error) {
    return adminResult(400, { error: parsedRef.error });
  }

  const { itemId: cleanItemId } = parsedRef;

  try {
    const [rows] = await db.query(
      'SELECT id, created_at FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ? LIMIT 1',
      [userId, cleanItemId, itemType]
    );

    const responseItemId = itemType === 'digital_art' ? String(cleanItemId) : cleanItemId;

    if (!rows || rows.length === 0) {
      return adminResult(200, {
        success: true,
        favorited: false,
        item_type: itemType,
        item_id: responseItemId,
      });
    }

    return adminResult(200, {
      success: true,
      favorited: true,
      favorite_id: rows[0].id,
      favorite_time: rows[0].created_at,
      item_type: itemType,
      item_id: responseItemId,
    });
  } catch (err) {
    logger.error('getFavoriteStatus failed', { err });
    return adminResult(500, { error: '查询收藏状态失败' });
  }
}

async function getFavoritesList(userId, query) {
  const { page = 1, pageSize = 10, itemType } = query || {};
  const pageNum = parseInt(page, 10) > 0 ? parseInt(page, 10) : 1;
  const sizeNum = parseInt(pageSize, 10) > 0 ? parseInt(pageSize, 10) : 10;
  const offset = (pageNum - 1) * sizeNum;

  try {
    let favoritesSql = 'SELECT id, item_id, item_type, created_at FROM favorites WHERE user_id = ?';
    const favoritesParams = [userId];

    if (itemType) {
      favoritesSql += ' AND item_type = ?';
      favoritesParams.push(itemType);
    }

    favoritesSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    favoritesParams.push(sizeNum, offset);

    const [favorites] = await db.query(favoritesSql, favoritesParams);

    if (!favorites || favorites.length === 0) {
      return adminResult(200, {
        success: true,
        data: [],
        pagination: {
          total: 0,
          page: pageNum,
          pageSize: sizeNum,
        },
      });
    }

    const artworkIds = [];
    const digitalIds = [];
    const rightIds = [];

    favorites.forEach((fav) => {
      if (fav.item_type === 'artwork') artworkIds.push(fav.item_id);
      if (fav.item_type === 'digital_art') digitalIds.push(String(fav.item_id));
      if (fav.item_type === 'copyright_item') rightIds.push(fav.item_id);
    });

    const artworksMap = {};
    if (artworkIds.length > 0) {
      const [artworks] = await db.query('SELECT id, title, image FROM original_artworks WHERE id IN (?)', [artworkIds]);
      artworks.forEach((art) => {
        artworksMap[art.id] = art;
      });
    }

    const digitalsMap = {};
    if (digitalIds.length > 0) {
      const [digitals] = await db.query('SELECT id, title, image_url FROM digital_artworks WHERE id IN (?)', [digitalIds]);
      digitals.forEach((dig) => {
        digitalsMap[String(dig.id)] = dig;
      });
      const [digitalsExt] = await db.query(
        `SELECT id, title, image_url FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} WHERE id IN (?)`,
        [digitalIds]
      );
      digitalsExt.forEach((dig) => {
        digitalsMap[String(dig.id)] = dig;
      });
    }

    const rightsMap = {};
    if (rightIds.length > 0) {
      const [rights] = await db.query(
        'SELECT r.id, r.title, ri.image_url FROM rights r LEFT JOIN right_images ri ON r.id = ri.right_id WHERE r.id IN (?)',
        [rightIds]
      );
      rights.forEach((right) => {
        rightsMap[right.id] = right;
      });
    }

    const resultData = favorites.map((fav) => {
      let title = '';
      let image_url = '';

      if (fav.item_type === 'artwork' && artworksMap[fav.item_id]) {
        title = artworksMap[fav.item_id].title;
        image_url = artworksMap[fav.item_id].image || '';
      } else if (fav.item_type === 'digital_art' && digitalsMap[String(fav.item_id)]) {
        const dig = digitalsMap[String(fav.item_id)];
        title = dig.title;
        image_url = dig.image_url || '';
      } else if (fav.item_type === 'copyright_item' && rightsMap[fav.item_id]) {
        title = rightsMap[fav.item_id].title;
        image_url = rightsMap[fav.item_id].image_url || '';
      }

      return {
        id: fav.id,
        item_id: fav.item_type === 'digital_art' ? String(fav.item_id) : fav.item_id,
        item_type: fav.item_type,
        title,
        image_url,
        favorite_time: fav.created_at,
      };
    });

    let countSql = 'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?';
    const countParams = [userId];
    if (itemType) {
      countSql += ' AND item_type = ?';
      countParams.push(itemType);
    }
    const [countResult] = await db.query(countSql, countParams);

    return adminResult(200, {
      success: true,
      data: resultData,
      pagination: {
        total: countResult[0].total,
        page: pageNum,
        pageSize: sizeNum,
      },
    });
  } catch (err) {
    logger.error('getFavoritesList failed', { err });
    return adminResult(500, { error: '服务器错误' });
  }
}

module.exports = {
  ensureFavoritesSchema,
  getFavoritesList,
  getFavoriteStatus,
  addFavorite,
  removeFavorite,
};
