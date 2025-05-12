const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');

function validateImageUrl(url) {
  if (!url) return false;
  if (url.startsWith('/uploads/') || url.startsWith('https://wx.oss.2000gallery.art/')) {
    return true;
  }
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'wx.oss.2000gallery.art';
  } catch (e) {
    return false;
  }
}

// 获取轮播图列表（公开接口）
router.get('/', async (req, res) => {
  try {
    const [banners] = await db.query(
      'SELECT * FROM banners WHERE status = "active" ORDER BY sort_order ASC'
    );
    
    // 处理图片URL
    const bannersWithFullUrls = banners.map(banner => ({
      ...banner,
      image_url: banner.image_url || ''
    }));
    
    res.json(bannersWithFullUrls);
  } catch (error) {
    console.error('获取轮播图列表失败:', error);
    res.status(500).json({ error: '获取轮播图列表失败' });
  }
});

// 获取所有轮播图（管理后台用）
router.get('/all', authenticateToken, async (req, res) => {
  try {
    const [banners] = await db.query(
      'SELECT * FROM banners ORDER BY sort_order ASC'
    );
    // 处理图片URL
    const bannersWithFullUrls = banners.map(banner => ({
      ...banner,
      image_url: banner.image_url || ''
    }));
    res.json(bannersWithFullUrls);
  } catch (error) {
    console.error('获取所有轮播图失败:', error);
    res.status(500).json({ error: '获取所有轮播图失败' });
  }
});

// 添加轮播图（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order } = req.body;
    
    if (!title || !image_url) {
      return res.status(400).json({ error: '标题和图片URL不能为空' });
    }
    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }

    const [result] = await db.query(
      'INSERT INTO banners (title, image_url, link_url, sort_order) VALUES (?, ?, ?, ?)',
      [title, image_url, link_url || null, sort_order || 0]
    );

    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [result.insertId]);
    res.json(banner[0]);
  } catch (error) {
    console.error('添加轮播图失败:', error);
    res.status(500).json({ error: '添加轮播图失败' });
  }
});

// 更新轮播图（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order, status } = req.body;
    
    if (!title || !image_url) {
      return res.status(400).json({ error: '标题和图片URL不能为空' });
    }
    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }

    await db.query(
      'UPDATE banners SET title = ?, image_url = ?, link_url = ?, sort_order = ?, status = ? WHERE id = ?',
      [title, image_url, link_url || null, sort_order || 0, status || 'active', req.params.id]
    );

    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [req.params.id]);
    res.json(banner[0]);
  } catch (error) {
    console.error('更新轮播图失败:', error);
    res.status(500).json({ error: '更新轮播图失败' });
  }
});

// 删除轮播图（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM banners WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除轮播图失败:', error);
    res.status(500).json({ error: '删除轮播图失败' });
  }
});

module.exports = router; 