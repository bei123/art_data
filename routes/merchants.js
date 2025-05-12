const express = require('express');
const router = express.Router();
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../auth');
const { uploadToOSS, deleteFromOSS } = require('../config/oss');
const BASE_URL = 'https://api.wx.2000gallery.art:2000';

// 验证图片URL的函数
const validateImageUrl = (url) => {
  if (!url) return false;
  return url.startsWith('http://') || url.startsWith('https://');
};

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 配置文件上传 - 使用内存存储
const storage = multer.memoryStorage();

// 文件类型验证
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  
  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('不支持的文件类型'));
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 限制文件大小为5MB
  }
});

// 获取商家列表接口
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '',
      status = 'active',
      sort_by = 'created_at',
      sort_order = 'DESC'
    } = req.query;

    const offset = (page - 1) * limit;
    
    // 构建查询条件
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (status) {
      whereClause += ' AND status = ?';
      params.push(status);
    }
    
    if (search) {
      whereClause += ' AND (name LIKE ? OR description LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }

    // 验证排序字段
    const allowedSortFields = ['created_at', 'sort_order', 'name'];
    const sortField = allowedSortFields.includes(sort_by) ? sort_by : 'created_at';
    const orderDirection = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // 查询总数
    const [countResult] = await db.query(
      `SELECT COUNT(*) as total FROM merchants ${whereClause}`,
      params
    );
    const total = countResult[0].total;

    // 查询商家列表
    const [merchants] = await db.query(
      `SELECT * FROM merchants 
       ${whereClause}
       ORDER BY ${sortField} ${orderDirection}
       LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // 查询每个商家的图片
    for (const merchant of merchants) {
      const [images] = await db.query(
        'SELECT image_url FROM merchant_images WHERE merchant_id = ?',
        [merchant.id]
      );
      merchant.images = images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      );
    }

    // 处理logo URL
    const merchantsWithFullUrls = merchants.map(merchant => ({
      ...merchant,
      logo: merchant.logo ? (merchant.logo.startsWith('http') ? merchant.logo : `${BASE_URL}${merchant.logo}`) : ''
    }));

    res.json({
      success: true,
      data: merchantsWithFullUrls,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('获取商家列表失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取商家列表失败' 
    });
  }
});

// 获取商家详情接口
router.get('/:id', async (req, res) => {
  try {
    // 获取商家基本信息
    const [merchants] = await db.query(
      'SELECT * FROM merchants WHERE id = ? AND status = "active"',
      [req.params.id]
    );

    if (!merchants || merchants.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: '商家不存在' 
      });
    }

    const merchant = merchants[0];

    // 获取商家图片
    const [images] = await db.query(
      'SELECT image_url FROM merchant_images WHERE merchant_id = ?',
      [req.params.id]
    );

    // 处理图片URL
    const merchantWithFullUrls = {
      ...merchant,
      logo: merchant.logo ? (merchant.logo.startsWith('http') ? merchant.logo : `${BASE_URL}${merchant.logo}`) : '',
      images: images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      )
    };

    res.json({
      success: true,
      data: merchantWithFullUrls
    });
  } catch (error) {
    console.error('获取商家详情失败:', error);
    res.status(500).json({ 
      success: false,
      error: '获取商家详情失败' 
    });
  }
});

// 商家Logo上传接口
router.post('/upload-logo', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    const result = await uploadToOSS(req.file);
    res.json(result);
  } catch (error) {
    console.error('商家Logo上传失败:', error);
    res.status(500).json({ error: '商家Logo上传失败' });
  }
});

// 商家图片上传接口
router.post('/upload-images', upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    const results = await Promise.all(req.files.map(file => uploadToOSS(file)));
    res.json(results);
  } catch (error) {
    console.error('商家图片上传失败:', error);
    res.status(500).json({ error: '商家图片上传失败' });
  }
});

// 创建商家接口
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, logo, description, address, phone, images } = req.body;
    
    // 验证logo URL
    if (!validateImageUrl(logo)) {
      return res.status(400).json({ error: '无效的Logo URL' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 插入商家基本信息
      const [result] = await connection.query(
        'INSERT INTO merchants (name, logo, description, address, phone, status) VALUES (?, ?, ?, ?, ?, "active")',
        [name, logo, description, address, phone]
      );

      const merchantId = result.insertId;

      // 插入商家图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [merchantId, image]);
        await connection.query(
          'INSERT INTO merchant_images (merchant_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();

      // 返回完整的商家信息
      const [newMerchant] = await db.query(
        'SELECT * FROM merchants WHERE id = ?',
        [merchantId]
      );

      res.json({
        success: true,
        data: newMerchant[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('创建商家失败:', error);
    res.status(500).json({ 
      success: false,
      error: '创建商家失败' 
    });
  }
});

// 更新商家接口
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { name, logo, description, address, phone, images } = req.body;
    
    // 验证logo URL
    if (!validateImageUrl(logo)) {
      return res.status(400).json({ error: '无效的Logo URL' });
    }

    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 更新商家基本信息
      await connection.query(
        'UPDATE merchants SET name = ?, logo = ?, description = ?, address = ?, phone = ? WHERE id = ?',
        [name, logo, description, address, phone, req.params.id]
      );

      // 删除旧图片
      await connection.query('DELETE FROM merchant_images WHERE merchant_id = ?', [req.params.id]);

      // 插入新图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [req.params.id, image]);
        await connection.query(
          'INSERT INTO merchant_images (merchant_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();

      // 返回更新后的商家信息
      const [updatedMerchant] = await db.query(
        'SELECT * FROM merchants WHERE id = ?',
        [req.params.id]
      );

      res.json({
        success: true,
        data: updatedMerchant[0]
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('更新商家失败:', error);
    res.status(500).json({ 
      success: false,
      error: '更新商家失败' 
    });
  }
});

// 删除商家接口
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 删除商家图片
      await connection.query('DELETE FROM merchant_images WHERE merchant_id = ?', [req.params.id]);
      
      // 删除商家
      await connection.query('DELETE FROM merchants WHERE id = ?', [req.params.id]);

      await connection.commit();
      res.json({
        success: true,
        message: '删除成功'
      });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除商家失败:', error);
    res.status(500).json({ 
      success: false,
      error: '删除商家失败' 
    });
  }
});

// 更新商家状态接口
router.patch('/:id/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['active', 'inactive'].includes(status)) {
      return res.status(400).json({ 
        success: false,
        error: '无效的状态值' 
      });
    }

    await db.query(
      'UPDATE merchants SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    res.json({
      success: true,
      message: '状态更新成功'
    });
  } catch (error) {
    console.error('更新商家状态失败:', error);
    res.status(500).json({ 
      success: false,
      error: '更新商家状态失败' 
    });
  }
});

// 更新商家排序接口
router.patch('/:id/sort', authenticateToken, async (req, res) => {
  try {
    const { sort_order } = req.body;
    
    if (typeof sort_order !== 'number') {
      return res.status(400).json({ 
        success: false,
        error: '无效的排序值' 
      });
    }

    await db.query(
      'UPDATE merchants SET sort_order = ? WHERE id = ?',
      [sort_order, req.params.id]
    );

    res.json({
      success: true,
      message: '排序更新成功'
    });
  } catch (error) {
    console.error('更新商家排序失败:', error);
    res.status(500).json({ 
      success: false,
      error: '更新商家排序失败' 
    });
  }
});

module.exports = router; 