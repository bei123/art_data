const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');
const redisClient = require('../utils/redisClient');
const REDIS_FAVORITES_LIST_KEY_PREFIX = 'favorites:list:';

// Token验证中间件
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: '未提供token' });
  }
  const token = authHeader.replace('Bearer ', '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token无效' });
  }
};

// 添加收藏
router.post('/', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.body;
  
  // 输入验证
  if (!itemId || !itemType) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 验证itemId
  const cleanItemId = parseInt(itemId);
  if (isNaN(cleanItemId) || cleanItemId <= 0) {
    return res.status(400).json({ error: '无效的物品ID' });
  }

  // 验证收藏类型
  const validTypes = ['artwork', 'digital_art', 'copyright_item'];
  if (!validTypes.includes(itemType)) {
    return res.status(400).json({ error: '无效的收藏类型' });
  }

  try {
    const userId = req.user.userId;
    // 检查是否已经收藏
    const checkSql = 'SELECT id FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
    const [existing] = await db.query(checkSql, [userId, itemId, itemType]);
    
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: '已经收藏过该物品' });
    }

    const sql = 'INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)';
    await db.query(sql, [userId, cleanItemId, itemType]);
    // 清理该用户所有收藏列表缓存
    const scanDel = async (pattern) => {
      let cursor = 0;
      do {
        const reply = await redisClient.scan(String(cursor), { MATCH: String(pattern), COUNT: 100 });
        cursor = reply.cursor;
        if (reply.keys.length > 0) {
          // 确保所有key都是字符串类型
          const stringKeys = reply.keys.map(key => String(key));
          await redisClient.del(...stringKeys.map(k => String(k)));
        }
      } while (cursor !== 0);
    };
    await scanDel(String(`${REDIS_FAVORITES_LIST_KEY_PREFIX}${String(userId)}:*`));
    res.json({ success: true });
  } catch (err) {
    console.error('添加收藏失败:', err);
    res.status(500).json({ error: '添加收藏服务暂时不可用' });
  }
});

// 取消收藏
router.delete('/:itemType/:itemId', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.params;
  const userId = req.user.userId;

  // 输入验证
  const cleanItemId = parseInt(itemId);
  if (isNaN(cleanItemId) || cleanItemId <= 0) {
    return res.status(400).json({ error: '无效的物品ID' });
  }

  // 验证收藏类型
  const validTypes = ['artwork', 'digital_art', 'copyright_item'];
  if (!validTypes.includes(itemType)) {
    return res.status(400).json({ error: '无效的收藏类型' });
  }

  try {
    const sql = 'DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
    const [result] = await db.query(sql, [userId, cleanItemId, itemType]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到该收藏记录' });
    }
    
    // 清理该用户所有收藏列表缓存
    const scanDel = async (pattern) => {
      let cursor = 0;
      do {
        const reply = await redisClient.scan(String(cursor), { MATCH: String(pattern), COUNT: 100 });
        cursor = reply.cursor;
        if (reply.keys.length > 0) {
          // 确保所有key都是字符串类型
          const stringKeys = reply.keys.map(key => String(key));
          await redisClient.del(...stringKeys);
        }
      } while (cursor !== 0);
    };
    await scanDel(`${REDIS_FAVORITES_LIST_KEY_PREFIX}${String(userId)}:*`);
    res.json({ success: true });
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
  
  // 生成缓存key
  const cacheKey = String(`${REDIS_FAVORITES_LIST_KEY_PREFIX}${String(userId)}:${itemType || 'all'}:${pageNum}:${sizeNum}`);
  // 先查redis缓存
  const cache = await redisClient.get(String(cacheKey));
  if (cache) {
    return res.json(JSON.parse(cache));
  }

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
      await redisClient.setEx(String(cacheKey), 60, JSON.stringify(result));
      return;
    }
    
    // 2. 分类收集ID
    const artworkIds = [];
    const digitalIds = [];
    const rightIds = [];
    
    favorites.forEach(fav => {
      if (fav.item_type === 'artwork') artworkIds.push(fav.item_id);
      if (fav.item_type === 'digital_art') digitalIds.push(fav.item_id);
      if (fav.item_type === 'copyright_item') rightIds.push(fav.item_id);
    });
    
    // 3. 批量查询商品信息
    let artworksMap = {};
    if (artworkIds.length > 0) {
      const [artworks] = await db.query(
        'SELECT id, title, image FROM original_artworks WHERE id IN (?)',
        [artworkIds]
      );
      artworks.forEach(art => { artworksMap[art.id] = art; });
    }
    
    let digitalsMap = {};
    if (digitalIds.length > 0) {
      const [digitals] = await db.query(
        'SELECT id, title, image_url FROM digital_artworks WHERE id IN (?)',
        [digitalIds]
      );
      digitals.forEach(dig => { digitalsMap[dig.id] = dig; });
    }
    
    let rightsMap = {};
    if (rightIds.length > 0) {
      const [rights] = await db.query(
        'SELECT id, title FROM rights WHERE id IN (?)',
        [rightIds]
      );
      rights.forEach(right => { rightsMap[right.id] = right; });
    }
    
    // 4. 组装返回数据
    const resultData = favorites.map(fav => {
      let title = '';
      let image_url = '';
      
      if (fav.item_type === 'artwork' && artworksMap[fav.item_id]) {
        title = artworksMap[fav.item_id].title;
        image_url = artworksMap[fav.item_id].image || '';
      } else if (fav.item_type === 'digital_art' && digitalsMap[fav.item_id]) {
        title = digitalsMap[fav.item_id].title;
        image_url = digitalsMap[fav.item_id].image_url || '';
      } else if (fav.item_type === 'copyright_item' && rightsMap[fav.item_id]) {
        title = rightsMap[fav.item_id].title;
        image_url = ''; // 实物商品图片需要单独查询
      }
      
      return {
        id: fav.id,
        item_id: fav.item_id,
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
    // 写入redis缓存，1分钟
    await redisClient.setEx(String(cacheKey), 60, JSON.stringify(result));
  } catch (err) {
    console.error('获取收藏列表失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router; 