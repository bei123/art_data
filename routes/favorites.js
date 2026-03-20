const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

const DIGITAL_ARTWORKS_EXTERNAL_TABLE = 'digital_artworks_external';

// Token验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: '未提供token' });
  }
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'token格式错误' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (!payload || !payload.userId) {
      return res.status(401).json({ error: 'token内容无效' });
    }
    req.user = payload;
    next();
  } catch (err) {
    console.error('Token验证失败:', err.message);
    return res.status(401).json({ error: 'token无效' });
  }
};

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
      await db.query(
        'ALTER TABLE favorites MODIFY item_id VARCHAR(64) NOT NULL'
      );
      console.log('[favorites] item_id 已升级为 VARCHAR(64)，以支持外部数字艺术品 goods_id');
    }
    favoritesSchemaReady = true;
  } catch (err) {
    console.warn('[favorites] ensureFavoritesSchema:', err.message);
    favoritesSchemaReady = true;
  }
}

router.use(async (req, res, next) => {
  try {
    await ensureFavoritesSchema();
    next();
  } catch (e) {
    next(e);
  }
});

/** 解析数字艺术品收藏用的 item_id：仅数字字符串，与 digital_artworks / digital_artworks_external 的 id 一致 */
function parseDigitalArtItemId(raw) {
  if (raw === undefined || raw === null) return { error: '无效的物品ID' };
  let s;
  if (typeof raw === 'string') {
    s = raw.trim();
  } else if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw > Number.MAX_SAFE_INTEGER || raw < Number.MIN_SAFE_INTEGER) {
      return {
        error: '数字艺术品ID请使用字符串传递，避免大整数精度丢失'
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

// 验证物品是否存在
const validateItemExists = async (itemId, itemType, connection = null) => {
  try {
    const q = connection ? connection.query.bind(connection) : db.query;
    switch (itemType) {
      case 'artwork': {
        const id = parseInt(itemId, 10);
        if (isNaN(id) || id <= 0) return false;
        const [result] = await q('SELECT id FROM original_artworks WHERE id = ?', [id]);
        return result && result.length > 0;
      }
      case 'digital_art': {
        const sid = String(itemId).trim();
        if (!sid) return false;
        const [legacy] = await q('SELECT id FROM digital_artworks WHERE id = ?', [sid]);
        if (legacy && legacy.length > 0) return true;
        const [ext] = await q(
          `SELECT id FROM ${DIGITAL_ARTWORKS_EXTERNAL_TABLE} WHERE id = ?`,
          [sid]
        );
        return ext && ext.length > 0;
      }
      case 'copyright_item': {
        const id = parseInt(itemId, 10);
        if (isNaN(id) || id <= 0) return false;
        const [result] = await q('SELECT id FROM rights WHERE id = ?', [id]);
        return result && result.length > 0;
      }
      default:
        return false;
    }
  } catch (err) {
    console.error('验证物品存在性失败:', err);
    return false;
  }
};

// 添加收藏
router.post('/', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.body;

  // 输入验证
  if (!itemId || !itemType) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 验证收藏类型
  const validTypes = ['artwork', 'digital_art', 'copyright_item'];
  if (!validTypes.includes(itemType)) {
    return res.status(400).json({ error: '无效的收藏类型' });
  }

  let cleanItemId;
  if (itemType === 'digital_art') {
    const parsed = parseDigitalArtItemId(itemId);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    cleanItemId = parsed.id;
  } else {
    const n = parseInt(itemId, 10);
    if (isNaN(n) || n <= 0) {
      return res.status(400).json({ error: '无效的物品ID' });
    }
    cleanItemId = n;
  }

  try {
    const userId = req.user.userId;

    // 验证用户ID
    if (!userId || isNaN(parseInt(userId)) || parseInt(userId) <= 0) {
      return res.status(400).json({ error: '无效的用户ID' });
    }

    // 使用事务确保数据一致性
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 验证物品是否存在
      const itemExists = await validateItemExists(cleanItemId, itemType, connection);
      if (!itemExists) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: '要收藏的物品不存在' });
      }

      // 检查是否已经收藏 - 使用cleanItemId保持一致性
      const checkSql = 'SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
      const [existing] = await connection.query(checkSql, [userId, cleanItemId, itemType]);

      if (existing && existing.length > 0) {
        await connection.rollback();
        connection.release();
        return res.status(400).json({ error: '已经收藏过该物品' });
      }

      const sql = 'INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)';
      await connection.query(sql, [userId, cleanItemId, itemType]);

      await connection.commit();
      connection.release();

      res.json({ success: true });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    console.error('添加收藏失败:', err);
    res.status(500).json({ error: '添加收藏服务暂时不可用' });
  }
});

// 取消收藏
router.delete('/:itemType/:itemId', authenticateToken, async (req, res) => {
  const { itemType, itemId } = req.params;
  const userId = req.user.userId;

  // 验证用户ID
  if (!userId || isNaN(parseInt(userId)) || parseInt(userId) <= 0) {
    return res.status(400).json({ error: '无效的用户ID' });
  }

  // 验证收藏类型
  const validTypes = ['artwork', 'digital_art', 'copyright_item'];
  if (!validTypes.includes(itemType)) {
    return res.status(400).json({ error: '无效的收藏类型' });
  }

  let cleanItemId;
  if (itemType === 'digital_art') {
    const parsed = parseDigitalArtItemId(decodeURIComponent(itemId));
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }
    cleanItemId = parsed.id;
  } else {
    const n = parseInt(itemId, 10);
    if (isNaN(n) || n <= 0) {
      return res.status(400).json({ error: '无效的物品ID' });
    }
    cleanItemId = n;
  }

  try {
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      const sql = 'DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
      const [result] = await connection.query(sql, [userId, cleanItemId, itemType]);

      if (result.affectedRows === 0) {
        await connection.rollback();
        connection.release();
        return res.status(404).json({ error: '未找到该收藏记录' });
      }

      await connection.commit();
      connection.release();

      res.json({ success: true });
    } catch (err) {
      await connection.rollback();
      connection.release();
      throw err;
    }
  } catch (err) {
    console.error('取消收藏失败:', err);
    res.status(500).json({ error: '取消收藏服务暂时不可用' });
  }
});

// 获取收藏列表
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { page = 1, pageSize = 10, itemType } = req.query;
  const pageNum = parseInt(page) > 0 ? parseInt(page) : 1;
  const sizeNum = parseInt(pageSize) > 0 ? parseInt(pageSize) : 10;
  const offset = (pageNum - 1) * sizeNum;

  try {
    // 1. 先查询收藏记录
    let favoritesSql = 'SELECT id, item_id, item_type, created_at FROM favorites WHERE user_id = ?';
    let favoritesParams = [userId];

    if (itemType) {
      favoritesSql += ' AND item_type = ?';
      favoritesParams.push(itemType);
    }

    favoritesSql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    favoritesParams.push(sizeNum, offset);

    const [favorites] = await db.query(favoritesSql, favoritesParams);

    if (!favorites || favorites.length === 0) {
      const result = {
        success: true,
        data: [],
        pagination: {
          total: 0,
          page: pageNum,
          pageSize: sizeNum
        }
      };
      res.json(result);
      return;
    }

    // 2. 分类收集ID
    const artworkIds = [];
    const digitalIds = [];
    const rightIds = [];

    favorites.forEach((fav) => {
      if (fav.item_type === 'artwork') artworkIds.push(fav.item_id);
      if (fav.item_type === 'digital_art') digitalIds.push(String(fav.item_id));
      if (fav.item_type === 'copyright_item') rightIds.push(fav.item_id);
    });

    // 3. 批量查询商品信息
    const artworksMap = {};
    if (artworkIds.length > 0) {
      const [artworks] = await db.query(
        'SELECT id, title, image FROM original_artworks WHERE id IN (?)',
        [artworkIds]
      );
      artworks.forEach((art) => {
        artworksMap[art.id] = art;
      });
    }

    const digitalsMap = {};
    if (digitalIds.length > 0) {
      const [digitals] = await db.query(
        'SELECT id, title, image_url FROM digital_artworks WHERE id IN (?)',
        [digitalIds]
      );
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

    // 4. 组装返回数据
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
        title: title,
        image_url: image_url,
        favorite_time: fav.created_at
      };
    });

    // 5. 获取总数
    let countSql = 'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?';
    let countParams = [userId];
    if (itemType) {
      countSql += ' AND item_type = ?';
      countParams.push(itemType);
    }
    const [countResult] = await db.query(countSql, countParams);

    const result = {
      success: true,
      data: resultData,
      pagination: {
        total: countResult[0].total,
        page: pageNum,
        pageSize: sizeNum
      }
    };

    res.json(result);
  } catch (err) {
    console.error('获取收藏列表失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router;
module.exports.ensureFavoritesSchema = ensureFavoritesSchema;
