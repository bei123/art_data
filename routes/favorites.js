const express = require('express');
const router = express.Router();
const db = require('../db');
const jwt = require('jsonwebtoken');

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

// 验证物品是否存在
const validateItemExists = async (itemId, itemType, connection = null) => {
  try {
    let sql = '';
    switch (itemType) {
      case 'artwork':
        sql = 'SELECT id FROM original_artworks WHERE id = ?';
        break;
      case 'digital_art':
        sql = 'SELECT id FROM digital_artworks WHERE id = ?';
        break;
      case 'copyright_item':
        sql = 'SELECT id FROM rights WHERE id = ?';
        break;
      default:
        return false;
    }
    const [result] = connection ? await connection.query(sql, [itemId]) : await db.query(sql, [itemId]);
    return result && result.length > 0;
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
  const { itemType, itemId } = req.params; // 修复参数顺序
  const userId = req.user.userId;

  // 验证用户ID
  if (!userId || isNaN(parseInt(userId)) || parseInt(userId) <= 0) {
    return res.status(400).json({ error: '无效的用户ID' });
  }

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
    // 使用事务确保数据一致性
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
        'SELECT r.id, r.title, ri.image_url FROM rights r LEFT JOIN right_images ri ON r.id = ri.right_id WHERE r.id IN (?)',
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
        image_url = rightsMap[fav.item_id].image_url || '';
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
  } catch (err) {
    console.error('获取收藏列表失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router; 