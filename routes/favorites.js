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
  try {
    const payload = jwt.verify(token, 'your_jwt_secret');
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token无效' });
  }
};

// 添加收藏
router.post('/', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.body;
  if (!itemId || !itemType) {
    return res.status(400).json({ error: '缺少必要参数' });
  }

  // 验证收藏类型
  const validTypes = ['artwork', 'digital_art', 'copyright_item'];
  if (!validTypes.includes(itemType)) {
    return res.status(400).json({ error: '无效的收藏类型' });
  }

  try {
    const userId = req.user.userId;
    // 检查是否已经收藏
    const checkSql = 'SELECT * FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
    const [existing] = await db.query(checkSql, [userId, itemId, itemType]);
    
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: '已经收藏过该物品' });
    }

    const sql = 'INSERT INTO favorites (user_id, item_id, item_type) VALUES (?, ?, ?)';
    await db.query(sql, [userId, itemId, itemType]);
    res.json({ success: true });
  } catch (err) {
    console.error('添加收藏失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 取消收藏
router.delete('/:itemType/:itemId', authenticateToken, async (req, res) => {
  const { itemId, itemType } = req.params;
  const userId = req.user.userId;

  try {
    const sql = 'DELETE FROM favorites WHERE user_id = ? AND item_id = ? AND item_type = ?';
    const result = await db.query(sql, [userId, itemId, itemType]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: '未找到该收藏记录' });
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('取消收藏失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 获取收藏列表
router.get('/', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const { page = 1, pageSize = 10, itemType } = req.query;

  try {
    const offset = (page - 1) * pageSize;
    let sql = '';
    let params = [];
    
    if (itemType) {
      // 获取特定类型的收藏
      sql = `
        SELECT f.*, 
          CASE f.item_type
            WHEN 'artwork' THEN oa.title
            WHEN 'digital_art' THEN da.title
            WHEN 'copyright_item' THEN r.title
          END as title,
          CASE f.item_type
            WHEN 'artwork' THEN oa.image
            WHEN 'digital_art' THEN da.image_url
            WHEN 'copyright_item' THEN ri.image_url
          END as image_url,
          f.created_at as favorite_time
        FROM favorites f
        LEFT JOIN original_artworks oa ON f.item_type = 'artwork' AND f.item_id = oa.id
        LEFT JOIN digital_artworks da ON f.item_type = 'digital_art' AND f.item_id = da.id
        LEFT JOIN rights r ON f.item_type = 'copyright_item' AND f.item_id = r.id
        LEFT JOIN right_images ri ON f.item_type = 'copyright_item' AND f.item_id = r.id AND ri.right_id = r.id
        WHERE f.user_id = ? AND f.item_type = ?
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, itemType, parseInt(pageSize), offset];
    } else {
      // 获取所有类型的收藏
      sql = `
        SELECT f.*, 
          CASE f.item_type
            WHEN 'artwork' THEN oa.title
            WHEN 'digital_art' THEN da.title
            WHEN 'copyright_item' THEN r.title
          END as title,
          CASE f.item_type
            WHEN 'artwork' THEN oa.image
            WHEN 'digital_art' THEN da.image_url
            WHEN 'copyright_item' THEN ri.image_url
          END as image_url,
          f.created_at as favorite_time
        FROM favorites f
        LEFT JOIN original_artworks oa ON f.item_type = 'artwork' AND f.item_id = oa.id
        LEFT JOIN digital_artworks da ON f.item_type = 'digital_art' AND f.item_id = da.id
        LEFT JOIN rights r ON f.item_type = 'copyright_item' AND f.item_id = r.id
        LEFT JOIN right_images ri ON f.item_type = 'copyright_item' AND f.item_id = r.id AND ri.right_id = r.id
        WHERE f.user_id = ?
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
      `;
      params = [userId, parseInt(pageSize), offset];
    }
    
    const [favorites] = await db.query(sql, params);
    
    // 获取总数
    let countSql = 'SELECT COUNT(*) as total FROM favorites WHERE user_id = ?';
    let countParams = [userId];
    if (itemType) {
      countSql += ' AND item_type = ?';
      countParams.push(itemType);
    }
    const [countResult] = await db.query(countSql, countParams);
    
    res.json({
      success: true,
      data: favorites,
      pagination: {
        total: countResult[0].total,
        page: parseInt(page),
        pageSize: parseInt(pageSize)
      }
    });
  } catch (err) {
    console.error('获取收藏列表失败:', err);
    res.status(500).json({ error: '服务器错误' });
  }
});

module.exports = router; 