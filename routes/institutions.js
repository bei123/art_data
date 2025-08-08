const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_INSTITUTIONS_LIST_KEY = 'institutions:list';
const REDIS_INSTITUTION_DETAIL_KEY_PREFIX = 'institutions:detail:';

// 获取机构列表（公开接口）
router.get('/', async (req, res) => {
  try {
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_INSTITUTIONS_LIST_KEY);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    
    const [rows] = await db.query('SELECT * FROM institutions ORDER BY created_at DESC');
    const institutionsWithProcessedImages = rows.map(institution => 
      processObjectImages(institution, ['logo'])
    );
    
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_INSTITUTIONS_LIST_KEY, JSON.stringify(institutionsWithProcessedImages));
    res.json(institutionsWithProcessedImages);
  } catch (error) {
    console.error('获取机构列表失败:', error);
    res.status(500).json({ error: '获取机构列表失败' });
  }
});

// 获取机构详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的机构ID' });
    }
    
    // 先查redis缓存
    const cache = await redisClient.get(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + id);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    
    const [rows] = await db.query('SELECT * FROM institutions WHERE id = ?', [id]);
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: '机构不存在' });
    }
    
    const institution = processObjectImages(rows[0], ['logo']);
    // 写入redis缓存，永久有效
    await redisClient.set(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + id, JSON.stringify(institution));
    res.json(institution);
  } catch (error) {
    console.error('获取机构详情失败:', error);
    res.status(500).json({ error: '获取机构详情服务暂时不可用' });
  }
});

// 创建机构（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, logo, description, address, phone, website } = req.body;
    
    // 输入验证
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: '机构名称不能为空' });
    }
    
    if (name.length > 100) {
      return res.status(400).json({ error: '机构名称长度不能超过100个字符' });
    }
    
    if (description && description.length > 2000) {
      return res.status(400).json({ error: '描述长度不能超过2000个字符' });
    }
    
    // 清理输入
    const cleanName = name.trim();
    const cleanDescription = description ? description.trim() : '';
    
    const [result] = await db.query(
      'INSERT INTO institutions (name, logo, description, address, phone, website) VALUES (?, ?, ?, ?, ?, ?)',
      [cleanName, logo, cleanDescription, address, phone, website]
    );
    
    // 清理缓存
    await redisClient.del(REDIS_INSTITUTIONS_LIST_KEY);
    res.json({ 
      id: result.insertId, 
      name: cleanName, 
      description: cleanDescription, 
      logo,
      address,
      phone,
      website
    });
  } catch (error) {
    console.error('Error creating institution:', error);
    res.status(500).json({ error: '创建机构服务暂时不可用' });
  }
});

// 更新机构（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { name, logo, description, address, phone, website } = req.body;
    
    // 验证图片URL
    if (logo && !validateImageUrl(logo)) {
      return res.status(400).json({ error: '无效的Logo URL' });
    }

    // 更新机构信息
    await db.query(
      'UPDATE institutions SET name = ?, logo = ?, description = ?, address = ?, phone = ?, website = ? WHERE id = ?',
      [name, logo, description, address, phone, website, req.params.id]
    );
    
    // 清理缓存
    await redisClient.del(REDIS_INSTITUTIONS_LIST_KEY);
    await redisClient.del(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + req.params.id);

    // 获取更新后的机构信息
    const [institutions] = await db.query('SELECT * FROM institutions WHERE id = ?', [req.params.id]);
    if (institutions.length === 0) {
      return res.status(404).json({ error: '机构不存在' });
    }

    const institution = institutions[0];
    // 处理图片URL
    const institutionWithFullUrls = {
      ...institution,
      logo: institution.logo || ''
    };

    res.json(institutionWithFullUrls);
  } catch (error) {
    console.error('Error updating institution:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

// 删除机构（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 检查是否有艺术家关联此机构
    const [artists] = await connection.query('SELECT COUNT(*) as count FROM artists WHERE institution_id = ?', [req.params.id]);
    if (artists[0].count > 0) {
      return res.status(400).json({ error: '无法删除机构，还有艺术家关联此机构' });
    }
    
    // 删除机构
    await connection.query('DELETE FROM institutions WHERE id = ?', [req.params.id]);

    await connection.commit();
    // 清理缓存
    await redisClient.del(REDIS_INSTITUTIONS_LIST_KEY);
    await redisClient.del(REDIS_INSTITUTION_DETAIL_KEY_PREFIX + req.params.id);
    res.json({ message: '删除成功' });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting institution:', error);
    res.status(500).json({ error: '删除失败' });
  } finally {
    connection.release();
  }
});

// 验证图片URL的函数
function validateImageUrl(url) {
  if (!url) return false;

  // 允许以 /uploads/ 开头，或以 OSS 域名开头
  if (url.startsWith('/uploads/') || url.startsWith('https://wx.oss.2000gallery.art/')) {
    return true;
  }

  // 允许完整 URL，主机名为 OSS 域名
  try {
    const urlObj = new URL(url);
    return urlObj.hostname === 'wx.oss.2000gallery.art';
  } catch (e) {
    return false;
  }
}

module.exports = router;
