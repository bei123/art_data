const express = require('express');
const router = express.Router();
const db = require('../db');
const { authenticateToken } = require('../auth');
const { processObjectImages } = require('../utils/image');

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
    const [rows] = await db.query('SELECT * FROM physical_categories');
    console.log('Physical categories query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid physical categories data:', rows);
      return res.json([]);
    }
    
    // 处理图片URL，添加WebP转换
    const categoriesWithProcessedImages = rows.map(category => 
      processObjectImages(category, ['image', 'icon'])
    );
    
    res.json(categoriesWithProcessedImages);
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
    
    const [result] = await db.query(
      'INSERT INTO physical_categories (title, image, icon, count, description) VALUES (?, ?, ?, ?, ?)',
      [title.trim(), image, icon, cleanCount, description ? description.trim() : '']
    );
    
    // 处理返回的图片URL，添加WebP转换
    const newCategory = processObjectImages({
      id: result.insertId,
      ...req.body
    }, ['image', 'icon']);
    
    res.json(newCategory);
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
    
    await db.query(
      'UPDATE physical_categories SET title = ?, image = ?, icon = ?, count = ?, description = ? WHERE id = ?',
      [title.trim(), image, icon, cleanCount, description ? description.trim() : '', id]
    );
    
    // 处理返回的图片URL，添加WebP转换
    const updatedCategory = processObjectImages({
      id: req.params.id,
      ...req.body
    }, ['image', 'icon']);
    
    res.json(updatedCategory);
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
    
    await db.query('DELETE FROM physical_categories WHERE id = ?', [id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting physical category:', error);
    res.status(500).json({ error: '删除实物分类服务暂时不可用' });
  }
});

module.exports = router; 