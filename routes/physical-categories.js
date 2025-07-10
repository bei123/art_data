const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');
const redisClient = require('../utils/redisClient');
const REDIS_PHYSICAL_CATEGORIES_LIST_KEY = 'physical_categories:list';

// 清理所有实物分类相关缓存
async function clearPhysicalCategoriesCache() {
  try {
    const keys = await redisClient.keys(`${REDIS_PHYSICAL_CATEGORIES_LIST_KEY}*`);
    if (keys.length > 0) {
      await redisClient.del(keys);
      console.log(`Cleared ${keys.length} physical categories cache keys`);
    }
  } catch (error) {
    console.error('Error clearing physical categories cache:', error);
  }
}

// 验证图片URL的函数
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

// 获取实物分类列表（公开接口）
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, sort = 'created_at', order = 'desc' } = req.query;
    
    // 输入验证
    const cleanPage = Math.max(1, parseInt(page) || 1);
    const cleanLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const cleanSort = ['id', 'title', 'count', 'created_at', 'updated_at'].includes(sort) ? sort : 'created_at';
    const cleanOrder = ['asc', 'desc'].includes(order.toLowerCase()) ? order.toLowerCase() : 'desc';
    
    const offset = (cleanPage - 1) * cleanLimit;
    
    // 先查redis缓存（仅适用于第一页且无排序参数时）
    const cacheKey = cleanPage === 1 && sort === 'created_at' && order === 'desc' 
      ? REDIS_PHYSICAL_CATEGORIES_LIST_KEY 
      : `${REDIS_PHYSICAL_CATEGORIES_LIST_KEY}:${cleanPage}:${cleanLimit}:${cleanSort}:${cleanOrder}`;
    
    const cache = await redisClient.get(cacheKey);
    if (cache) {
      return res.json(JSON.parse(cache));
    }
    
    // 查询总数
    const [[{ total }]] = await db.query('SELECT COUNT(*) as total FROM physical_categories');
    
    // 查询分类数据，只查询必要字段
    const [rows] = await db.query(`
      SELECT 
        id,
        title,
        image,
        icon,
        count,
        description,
        created_at,
        updated_at
      FROM physical_categories 
      ORDER BY ${cleanSort} ${cleanOrder.toUpperCase()}
      LIMIT ? OFFSET ?
    `, [cleanLimit, offset]);
    
    console.log('Physical categories query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid physical categories data:', rows);
      return res.json({
        data: [],
        pagination: {
          total: 0,
          page: cleanPage,
          limit: cleanLimit,
          totalPages: 0
        }
      });
    }
    
    // 处理图片URL，添加WebP转换
    const categoriesWithProcessedImages = rows.map(category => 
      processObjectImages(category, ['image', 'icon'])
    );
    
    const result = {
      data: categoriesWithProcessedImages,
      pagination: {
        total: parseInt(total),
        page: cleanPage,
        limit: cleanLimit,
        totalPages: Math.ceil(parseInt(total) / cleanLimit)
      }
    };
    
    res.json(result);
    
    // 写入redis缓存，7天过期（仅缓存第一页默认排序）
    if (cleanPage === 1 && sort === 'created_at' && order === 'desc') {
      await redisClient.setEx(REDIS_PHYSICAL_CATEGORIES_LIST_KEY, 604800, JSON.stringify(result));
    }
  } catch (error) {
    console.error('Error fetching physical categories:', error);
    res.status(500).json({ error: '获取实物分类数据服务暂时不可用' });
  }
});

// 创建实物分类（需要认证）
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { title, image, icon, count, description } = req.body;
    
    // 输入验证
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: '分类名称不能为空' });
    }
    
    if (title.length > 100) {
      return res.status(400).json({ error: '分类名称长度不能超过100个字符' });
    }
    
    if (description && description.length > 1000) {
      return res.status(400).json({ error: '描述长度不能超过1000个字符' });
    }
    
    // 验证数量
    const cleanCount = parseInt(count) || 0;
    if (cleanCount < 0 || cleanCount > 999999) {
      return res.status(400).json({ error: '数量必须在0-999999之间' });
    }
    
    const cleanTitle = title.trim();
    const cleanDescription = description ? description.trim() : '';
    
    // 检查是否存在重复的分类名称
    const [existing] = await db.query(
      'SELECT id FROM physical_categories WHERE title = ?',
      [cleanTitle]
    );
    
    if (existing && existing.length > 0) {
      return res.status(400).json({ error: '分类名称已存在' });
    }
    
    const [result] = await db.query(
      'INSERT INTO physical_categories (title, image, icon, count, description) VALUES (?, ?, ?, ?, ?)',
      [cleanTitle, image, icon, cleanCount, cleanDescription]
    );
    
    // 查询新创建的记录
    const [newCategory] = await db.query(`
      SELECT 
        id,
        title,
        image,
        icon,
        count,
        description,
        created_at,
        updated_at
      FROM physical_categories 
      WHERE id = ?
    `, [result.insertId]);
    
    if (!newCategory || newCategory.length === 0) {
      return res.status(500).json({ error: '创建分类失败' });
    }
    
    // 处理返回的图片URL，添加WebP转换
    const processedCategory = processObjectImages(newCategory[0], ['image', 'icon']);
    
    // 清理缓存
    await clearPhysicalCategoriesCache();
    res.json(processedCategory);
  } catch (error) {
    console.error('Error creating physical category:', error);
    res.status(500).json({ error: '创建实物分类服务暂时不可用' });
  }
});

// 更新实物分类（需要认证）
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的分类ID' });
    }
    
    const { title, image, icon, count, description } = req.body;
    
    // 输入验证
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: '分类名称不能为空' });
    }
    
    if (title.length > 100) {
      return res.status(400).json({ error: '分类名称长度不能超过100个字符' });
    }
    
    if (description && description.length > 1000) {
      return res.status(400).json({ error: '描述长度不能超过1000个字符' });
    }
    
    // 验证数量
    const cleanCount = parseInt(count) || 0;
    if (cleanCount < 0 || cleanCount > 999999) {
      return res.status(400).json({ error: '数量必须在0-999999之间' });
    }
    
    const cleanTitle = title.trim();
    const cleanDescription = description ? description.trim() : '';
    
    // 检查分类是否存在
    const [existing] = await db.query(
      'SELECT id, title FROM physical_categories WHERE id = ?',
      [id]
    );
    
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }
    
    // 检查是否存在重复的分类名称（排除当前记录）
    const [duplicate] = await db.query(
      'SELECT id FROM physical_categories WHERE title = ? AND id != ?',
      [cleanTitle, id]
    );
    
    if (duplicate && duplicate.length > 0) {
      return res.status(400).json({ error: '分类名称已存在' });
    }
    
    await db.query(
      'UPDATE physical_categories SET title = ?, image = ?, icon = ?, count = ?, description = ?, updated_at = NOW() WHERE id = ?',
      [cleanTitle, image, icon, cleanCount, cleanDescription, id]
    );
    
    // 查询更新后的记录
    const [updatedCategory] = await db.query(`
      SELECT 
        id,
        title,
        image,
        icon,
        count,
        description,
        created_at,
        updated_at
      FROM physical_categories 
      WHERE id = ?
    `, [id]);
    
    if (!updatedCategory || updatedCategory.length === 0) {
      return res.status(500).json({ error: '更新分类失败' });
    }
    
    // 处理返回的图片URL，添加WebP转换
    const processedCategory = processObjectImages(updatedCategory[0], ['image', 'icon']);
    
    // 清理缓存
    await clearPhysicalCategoriesCache();
    res.json(processedCategory);
  } catch (error) {
    console.error('Error updating physical category:', error);
    res.status(500).json({ error: '更新实物分类服务暂时不可用' });
  }
});

// 删除实物分类（需要认证）
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的分类ID' });
    }
    
    // 检查分类是否存在
    const [existing] = await db.query(
      'SELECT id, title FROM physical_categories WHERE id = ?',
      [id]
    );
    
    if (!existing || existing.length === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }
    
    await db.query('DELETE FROM physical_categories WHERE id = ?', [id]);
    
    // 清理所有相关缓存
    await clearPhysicalCategoriesCache();
    
    res.json({ 
      message: '删除成功',
      deletedCategory: {
        id: existing[0].id,
        title: existing[0].title
      }
    });
  } catch (error) {
    console.error('Error deleting physical category:', error);
    res.status(500).json({ error: '删除实物分类服务暂时不可用' });
  }
});

// 获取单个实物分类详情（公开接口）
router.get('/:id', async (req, res) => {
  try {
    // 验证ID参数
    const id = parseInt(req.params.id);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({ error: '无效的分类ID' });
    }
    
    // 查询分类详情，只查询必要字段
    const [categories] = await db.query(`
      SELECT 
        id,
        title,
        image,
        icon,
        count,
        description,
        created_at,
        updated_at
      FROM physical_categories 
      WHERE id = ?
    `, [id]);
    
    if (!categories || categories.length === 0) {
      return res.status(404).json({ error: '分类不存在' });
    }
    
    // 处理图片URL，添加WebP转换
    const processedCategory = processObjectImages(categories[0], ['image', 'icon']);
    
    res.json(processedCategory);
  } catch (error) {
    console.error('Error fetching physical category:', error);
    res.status(500).json({ error: '获取实物分类详情服务暂时不可用' });
  }
});

module.exports = router; 