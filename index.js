const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const https = require('https');
const fs = require('fs');
const { body } = require('express-validator');
const auth = require('./auth');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const xml2js = require('xml2js');
const wxRouter = require('./routes/wx');
const wxpayRouter = require('./routes/pay');
const favoritesRouter = require('./routes/favorites');
const merchantsRouter = require('./routes/merchants');
const cartRouter = require('./routes/cart');
const bannersRouter = require('./routes/banners');
const artistsRouter = require('./routes/artists');
const artworksRouter = require('./routes/artworks');
const digitalArtworksRouter = require('./routes/digital-artworks');
const physicalCategoriesRouter = require('./routes/physical-categories');

const app = express();
const port = 2000;

// CORS 配置
app.use(cors({
  origin: function(origin, callback) {
    const allowedOrigins = [
      'http://localhost:5173',
      'https://wx.ht.2000gallery.art',
      'http://wx.ht.2000gallery.art',
      'https://www.wx.ht.2000gallery.art',
      'http://www.wx.ht.2000gallery.art'
    ];
    
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, origin);
    } else {
      callback(new Error('CORS not allowed'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  exposedHeaders: ['Authorization']
}));

// 安全相关的响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// 解析JSON请求体
app.use(express.json());

// 解析URL编码的请求体
app.use(express.urlencoded({ extended: true }));

// 静态文件服务
app.use('/uploads', express.static('uploads'));

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// SSL证书配置
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'api.wx.2000gallery.art.key')),
  cert: fs.readFileSync(path.join(__dirname, 'api.wx.2000gallery.art.pem'))
};

// 添加基础URL配置
const BASE_URL = 'https://api.wx.2000gallery.art:2000';

// 配置文件上传
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    // 获取文件扩展名
    const ext = path.extname(file.originalname).toLowerCase();
    // 生成文件名
    cb(null, Date.now() + ext);
  }
});

// 文件类型验证
const fileFilter = (req, file, cb) => {
  // 允许的文件类型
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

// 配置中间件
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 文件上传接口
app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    const fileUrl = `/uploads/${req.file.filename}`;
    const fullUrl = `${BASE_URL}${fileUrl}`;
    res.json({ 
      url: fileUrl,
      fullUrl: fullUrl,
      filename: req.file.filename,
      size: req.file.size
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    res.status(500).json({ error: '文件上传失败' });
  }
});





// 实物分类相关接口
app.get('/api/physical-categories', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM physical_categories');
    console.log('Physical categories query result:', rows);
    
    if (!rows || !Array.isArray(rows)) {
      console.log('Invalid physical categories data:', rows);
      return res.json([]);
    }
    
    // 为每个分类的图片添加完整URL
    const categoriesWithFullUrls = rows.map(category => ({
      ...category,
      image: category.image ? (category.image.startsWith('http') ? category.image : `${BASE_URL}${category.image}`) : '',
      icon: category.icon ? (category.icon.startsWith('http') ? category.icon : `${BASE_URL}${category.icon}`) : ''
    }));
    res.json(categoriesWithFullUrls);
  } catch (error) {
    console.error('Error fetching physical categories:', error);
    res.status(500).json({ error: '获取数据失败' });
  }
});

app.post('/api/physical-categories', async (req, res) => {
  try {
    const { title, image, icon, count, description } = req.body;
    const [result] = await db.query(
      'INSERT INTO physical_categories (title, image, icon, count, description) VALUES (?, ?, ?, ?, ?)',
      [title, image, icon, count, description]
    );
    res.json({ id: result.insertId, ...req.body });
  } catch (error) {
    console.error('Error creating physical category:', error);
    res.status(500).json({ error: '创建失败' });
  }
});

app.put('/api/physical-categories/:id', async (req, res) => {
  try {
    const { title, image, icon, count, description } = req.body;
    await db.query(
      'UPDATE physical_categories SET title = ?, image = ?, icon = ?, count = ?, description = ? WHERE id = ?',
      [title, image, icon, count, description, req.params.id]
    );
    res.json({ id: req.params.id, ...req.body });
  } catch (error) {
    console.error('Error updating physical category:', error);
    res.status(500).json({ error: '更新失败' });
  }
});

app.delete('/api/physical-categories/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM physical_categories WHERE id = ?', [req.params.id]);
    res.json({ message: '删除成功' });
  } catch (error) {
    console.error('Error deleting physical category:', error);
    res.status(500).json({ error: '删除失败' });
  }
});



// 获取版权实物列表
app.get('/api/rights', async (req, res) => {
  try {
    // 获取版权实物基本信息和分类信息
    const [rows] = await db.query(`
      SELECT r.*, c.title as category_title
      FROM rights r
      LEFT JOIN physical_categories c ON r.category_id = c.id
      ORDER BY r.id DESC
    `);
    
    if (!rows || !Array.isArray(rows)) {
      return res.json([]);
    }

    // 获取每个版权实物的图片
    for (const right of rows) {
      const [images] = await db.query(
        'SELECT image_url FROM right_images WHERE right_id = ?',
        [right.id]
      );
      right.images = images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      );
    }

    res.json(rows);
  } catch (error) {
    console.error('获取版权实物列表失败:', error);
    res.status(500).json({ error: '获取版权实物列表失败' });
  }
});

// 新增版权实物（增加 category_id）
app.post('/api/rights', async (req, res) => {
  try {
    const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id } = req.body;
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 插入版权实物基本信息
      const [result] = await connection.query(
        'INSERT INTO rights (title, status, price, original_price, period, total_count, remaining_count, description, category_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [title, status, price, originalPrice, period, totalCount, remainingCount, description, category_id]
      );

      const rightId = result.insertId;

      // 插入图片
      if (images && images.length > 0) {
        const imageValues = images.map(image => [rightId, image]);
        await connection.query(
          'INSERT INTO right_images (right_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();
      // 返回完整的版权实物信息
      const [newRight] = await db.query(`
        SELECT r.*, c.title as category_title
        FROM rights r
        LEFT JOIN physical_categories c ON r.category_id = c.id
        WHERE r.id = ?
        GROUP BY r.id
      `, [rightId]);

      res.json(newRight[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('创建版权实物失败:', error);
    res.status(500).json({ error: '创建版权实物失败' });
  }
});

// 编辑版权实物（增加 category_id）
app.put('/api/rights/:id', async (req, res) => {
  try {
    const { title, status, price, originalPrice, period, totalCount, remainingCount, description, images, category_id } = req.body;
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 更新版权实物基本信息
      await connection.query(
        'UPDATE rights SET title = ?, status = ?, price = ?, original_price = ?, period = ?, total_count = ?, remaining_count = ?, description = ?, category_id = ? WHERE id = ?',
        [title, status, price, originalPrice, period, totalCount, remainingCount, description, category_id, req.params.id]
      );

      // 删除旧图片
      await connection.query('DELETE FROM right_images WHERE right_id = ?', [req.params.id]);

      // 插入新图片，处理图片URL
      if (images && images.length > 0) {
        const imageValues = images.map(image => {
          // 如果是完整URL，需要移除BASE_URL前缀
          const imageUrl = image.startsWith(BASE_URL) ? image.substring(BASE_URL.length) : image;
          return [req.params.id, imageUrl];
        });
        await connection.query(
          'INSERT INTO right_images (right_id, image_url) VALUES ?',
          [imageValues]
        );
      }

      await connection.commit();
      // 返回更新后的版权实物信息
      const [updatedRight] = await db.query(`
        SELECT r.*, c.title as category_title
        FROM rights r
        LEFT JOIN physical_categories c ON r.category_id = c.id
        WHERE r.id = ?
        GROUP BY r.id
      `, [req.params.id]);

      // 获取并处理图片URL
      const [rightImages] = await db.query(
        'SELECT image_url FROM right_images WHERE right_id = ?',
        [req.params.id]
      );
      updatedRight[0].images = rightImages.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      );

      res.json(updatedRight[0]);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('更新版权实物失败:', error);
    res.status(500).json({ error: '更新版权实物失败' });
  }
});

// 删除版权实物
app.delete('/api/rights/:id', async (req, res) => {
  try {
    // 开始事务
    const connection = await db.getConnection();
    await connection.beginTransaction();

    try {
      // 先删除相关的订单项
      await connection.query('DELETE FROM order_items WHERE right_id = ?', [req.params.id]);
      
      // 删除图片
      await connection.query('DELETE FROM right_images WHERE right_id = ?', [req.params.id]);
      
      // 删除版权实物
      await connection.query('DELETE FROM rights WHERE id = ?', [req.params.id]);

      await connection.commit();
      res.json({ message: '删除成功' });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('删除版权实物失败:', error);
    res.status(500).json({ error: '删除版权实物失败' });
  }
});

// 获取版权实物详情（公开接口）
app.get('/api/rights/public/:id', async (req, res) => {
  try {
    const [right] = await db.query('SELECT * FROM rights WHERE id = ?', [req.params.id]);
    
    if (!right || right.length === 0) {
      return res.status(404).json({ error: '版权实物不存在' });
    }

    const [images] = await db.query(
      'SELECT image_url FROM right_images WHERE right_id = ?',
      [req.params.id]
    );

    const [details] = await db.query(
      'SELECT title, content FROM right_details WHERE right_id = ?',
      [req.params.id]
    );

    const [rules] = await db.query(
      'SELECT title, content FROM right_rules WHERE right_id = ?',
      [req.params.id]
    );

    // 获取分类信息
    const [category] = await db.query(
      'SELECT * FROM physical_categories WHERE id = ?',
      [right[0].category_id]
    );

    res.json({
      id: right[0].id,
      title: right[0].title,
      price: right[0].price,
      originalPrice: right[0].original_price,
      description: right[0].description,
      status: right[0].status,
      period: right[0].period,
      remainingCount: right[0].remaining_count,
      totalCount: right[0].total_count,
      category: {
        id: category[0]?.id || null,
        title: category[0]?.title || '',
        image: category[0]?.image ? (category[0].image.startsWith('http') ? category[0].image : `${BASE_URL}${category[0].image}`) : '',
        icon: category[0]?.icon ? (category[0].icon.startsWith('http') ? category[0].icon : `${BASE_URL}${category[0].icon}`) : '',
        count: category[0]?.count || 0,
        description: category[0]?.description || ''
      },
      images: images.map(img => 
        img.image_url.startsWith('http') ? img.image_url : `${BASE_URL}${img.image_url}`
      ),
      details: details.map(detail => ({
        title: detail.title,
        content: detail.content
      })),
      rules: rules.map(rule => ({
        title: rule.title,
        content: rule.content
      })),
      createdAt: right[0].created_at,
      updatedAt: right[0].updated_at
    });
  } catch (error) {
    console.error('获取版权实物详情失败:', error);
    res.status(500).json({ error: '获取版权实物详情失败' });
  }
});

// 搜索接口
app.get('/api/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    if (!keyword) {
      return res.status(400).json({ error: '请输入搜索关键词' });
    }

    const searchTerm = `%${keyword}%`;
    
    // 搜索艺术家
    const [artistRows] = await db.query(
      `SELECT id, name, avatar, description, 'artist' as type 
       FROM artists 
       WHERE name LIKE ? OR description LIKE ?`,
      [searchTerm, searchTerm]
    );

    // 搜索原创作品
    const [artworkRows] = await db.query(
      `SELECT id, title, image, description, 'original_artwork' as type 
       FROM original_artworks 
       WHERE title LIKE ? OR description LIKE ?`,
      [searchTerm, searchTerm]
    );

    // 搜索数字作品
    const [digitalRows] = await db.query(
      `SELECT id, title, image_url as image, description, 'digital_artwork' as type 
       FROM digital_artworks 
       WHERE title LIKE ? OR description LIKE ?`,
      [searchTerm, searchTerm]
    );

    // 合并结果并添加完整URL
    const results = [
      ...artistRows.map(item => ({
        ...item,
        avatar: item.avatar ? (item.avatar.startsWith('http') ? item.avatar : `${BASE_URL}${item.avatar}`) : ''
      })),
      ...artworkRows.map(item => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
      })),
      ...digitalRows.map(item => ({
        ...item,
        image: item.image ? (item.image.startsWith('http') ? item.image : `${BASE_URL}${item.image}`) : ''
      }))
    ];

    res.json(results);
  } catch (error) {
    console.error('搜索失败:', error);
    res.status(500).json({ error: '搜索失败' });
  }
});


  

// 认证相关路由
app.post('/api/auth/register', [
  body('username').isLength({ min: 3 }).withMessage('用户名至少3个字符'),
  body('email').isEmail().withMessage('请输入有效的邮箱地址'),
  body('password').isLength({ min: 6 }).withMessage('密码至少6个字符')
], auth.register);

app.post('/api/auth/login', [
  body('username').notEmpty().withMessage('请输入用户名'),
  body('password').notEmpty().withMessage('请输入密码')
], auth.login);

app.get('/api/auth/me', auth.authenticateToken, auth.getCurrentUser);

app.post('/api/auth/logout', auth.authenticateToken, auth.logout);

// 保护需要认证的路由
// app.use('/api/original-artworks', auth.authenticateToken);
// app.use('/api/digital-artworks', auth.authenticateToken);
app.use('/api/rights', auth.authenticateToken);

// 保护需要管理员权限的路由
app.use('/api/admin/*', auth.authenticateToken, auth.checkRole(['admin']));





// 获取用户的数字身份购买记录
app.get('/api/digital-identity/purchases/:user_id', async (req, res) => {
  try {
    const [purchases] = await db.query(`
      SELECT 
        dip.*,
        da.title as artwork_title,
        da.image_url as artwork_image
      FROM digital_identity_purchases dip
      JOIN digital_artworks da ON dip.digital_artwork_id = da.id
      WHERE dip.user_id = ?
      ORDER BY dip.purchase_date DESC
    `, [req.params.user_id]);

    res.json(purchases);
  } catch (error) {
    console.error('获取数字身份购买记录失败:', error);
    res.status(500).json({ error: '获取数字身份购买记录失败' });
  }
});

// 使用微信路由
app.use('/api/wx', wxRouter);

// 使用微信支付路由
app.use('/api/wx/pay', wxpayRouter);

// 使用收藏路由
app.use('/api/favorites', favoritesRouter);

// 使用商家路由
app.use('/api/merchants', merchantsRouter);

// 使用购物车路由
app.use('/api/cart', cartRouter);

// 使用轮播图路由
app.use('/api/banners', bannersRouter);

// 使用艺术家路由
app.use('/api/artists', artistsRouter);

// 使用艺术品路由
app.use('/api/original-artworks', artworksRouter);

// 使用数字艺术品路由
app.use('/api/digital-artworks', digitalArtworksRouter);

// 使用实物分类路由
app.use('/api/physical-categories', physicalCategoriesRouter);

// 启动HTTPS服务器
const PORT = process.env.PORT || 2000;
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`HTTPS服务器运行在端口 ${PORT}`);
}); 

