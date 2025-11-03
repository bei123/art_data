const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_BANNERS_LIST_KEY = 'banners:list';
const REDIS_BANNERS_ALL_KEY = 'banners:all';

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
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_BANNERS_LIST_KEY);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    const [banners] = await db.query(
      'SELECT id, title, image_url, link_url, sort_order FROM banners WHERE status = "active" ORDER BY sort_order ASC'
    );

    // 处理图片URL，添加WebP转换
    const bannersWithProcessedImages = banners.map(banner =>
      processObjectImages(banner, ['image_url'])
    );

    res.json(bannersWithProcessedImages);
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_BANNERS_LIST_KEY, JSON.stringify(bannersWithProcessedImages));
  } catch (error) {
    console.error('获取轮播图列表失败:', error);
    res.status(500).json({ error: '获取轮播图列表服务暂时不可用' });
  }
});

// 获取所有轮播图（管理后台用）
router.get('/all', authenticateToken, async (req, res) => {
  try {
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_BANNERS_ALL_KEY);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    const [banners] = await db.query(
      'SELECT id, title, image_url, link_url, sort_order, status FROM banners ORDER BY sort_order ASC'
    );

    // 处理图片URL，添加WebP转换
    const bannersWithProcessedImages = banners.map(banner =>
      processObjectImages(banner, ['image_url'])
    );

    res.json(bannersWithProcessedImages);
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_BANNERS_ALL_KEY, JSON.stringify(bannersWithProcessedImages));
  } catch (error) {
    console.error('获取所有轮播图失败:', error);
    res.status(500).json({ error: '获取所有轮播图服务暂时不可用' });
  }
});

// 添加轮播图（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, image_url, link_url, sort_order } = req.body;

    // 输入验证
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: '标题不能为空' });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: '标题长度不能超过200个字符' });
    }

    if (!image_url) {
      return res.status(400).json({ error: '图片URL不能为空' });
    }

    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }

    // 验证排序值
    const cleanSortOrder = parseInt(sort_order) || 0;
    if (cleanSortOrder < 0 || cleanSortOrder > 9999) {
      return res.status(400).json({ error: '排序值必须在0-9999之间' });
    }

    const [result] = await db.query(
      'INSERT INTO banners (title, image_url, link_url, sort_order) VALUES (?, ?, ?, ?)',
      [title.trim(), image_url, link_url || null, cleanSortOrder]
    );

    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [result.insertId]);
    // 处理返回的图片URL，添加WebP转换
    const processedBanner = processObjectImages(banner[0], ['image_url']);
    // 清理缓存
    await redisClient.del(REDIS_BANNERS_LIST_KEY);
    await redisClient.del(REDIS_BANNERS_ALL_KEY);
    res.json(processedBanner);
  } catch (error) {
    console.error('添加轮播图失败:', error);
    res.status(500).json({ error: '添加轮播图服务暂时不可用' });
  }
});

// 更新轮播图（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的轮播图ID' });
    }

    const { title, image_url, link_url, sort_order, status } = req.body;

    // 输入验证
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: '标题不能为空' });
    }

    if (title.length > 200) {
      return res.status(400).json({ error: '标题长度不能超过200个字符' });
    }

    if (!image_url) {
      return res.status(400).json({ error: '图片URL不能为空' });
    }

    if (!validateImageUrl(image_url)) {
      return res.status(400).json({ error: '无效的图片URL' });
    }

    // 验证排序值
    const cleanSortOrder = parseInt(sort_order) || 0;
    if (cleanSortOrder < 0 || cleanSortOrder > 9999) {
      return res.status(400).json({ error: '排序值必须在0-9999之间' });
    }

    // 验证状态
    const validStatuses = ['active', 'inactive'];
    const cleanStatus = validStatuses.includes(status) ? status : 'active';

    await db.query(
      'UPDATE banners SET title = ?, image_url = ?, link_url = ?, sort_order = ?, status = ? WHERE id = ?',
      [title.trim(), image_url, link_url || null, cleanSortOrder, cleanStatus, id]
    );

    const [banner] = await db.query('SELECT * FROM banners WHERE id = ?', [id]);
    // 处理返回的图片URL，添加WebP转换
    const processedBanner = processObjectImages(banner[0], ['image_url']);
    // 清理缓存
    await redisClient.del(REDIS_BANNERS_LIST_KEY);
    await redisClient.del(REDIS_BANNERS_ALL_KEY);
    res.json(processedBanner);
  } catch (error) {
    console.error('更新轮播图失败:', error);
    res.status(500).json({ error: '更新轮播图服务暂时不可用' });
  }
});

// 删除轮播图（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的轮播图ID' });
    }

    await db.query('DELETE FROM banners WHERE id = ?', [id]);
    // 清理缓存
    await redisClient.del(REDIS_BANNERS_LIST_KEY);
    await redisClient.del(REDIS_BANNERS_ALL_KEY);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('删除轮播图失败:', error);
    res.status(500).json({ error: '删除轮播图服务暂时不可用' });
  }
});

module.exports = router; 