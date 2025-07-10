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
const { uploadToOSS } = require('./config/oss');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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
const rightsRouter = require('./routes/rights');
const uploadRouter = require('./routes/upload');

const app = express();
const port = 2000;

// 安全中间件配置
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// 速率限制配置
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 1000, // 限制每个IP 15分钟内最多1000个请求
  message: {
    error: '请求过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// 对API路由应用速率限制
app.use('/api/', limiter);

// 对登录接口应用更严格的速率限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 10, // 限制每个IP 15分钟内最多5次登录尝试
  message: {
    error: '登录尝试过于频繁，请稍后再试'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/auth/login', loginLimiter);

// CORS 配置
app.use(cors({
  origin: function (origin, callback) {
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

// 请求体大小限制
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// 配置文件上传 - 使用内存存储
const storage = multer.memoryStorage();

// 文件类型验证
const fileFilter = (req, file, cb) => {
  // 允许的文件类型
  const allowedTypes = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'
  ];
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
    fileSize: 100 * 1024 * 1024 // 限制文件大小为100MB
  }
});

// 静态文件服务
app.use('/uploads', express.static('uploads'));

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// 文件上传接口
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }
    
    const result = await uploadToOSS(req.file);
    res.json({
      url: result.url,
      name: result.name,
      size: result.size
    });
  } catch (error) {
    console.error('文件上传失败:', error);
    res.status(500).json({ error: '文件上传服务暂时不可用，请稍后再试' });
  }
});

// 搜索接口
app.get('/api/search', async (req, res) => {
  try {
    const { keyword } = req.query;
    
    // 输入验证
    if (!keyword || typeof keyword !== 'string') {
      return res.status(400).json({ error: '请输入有效的搜索关键词' });
    }
    
    // 清理和验证关键词
    const cleanKeyword = keyword.trim();
    if (cleanKeyword.length < 1 || cleanKeyword.length > 100) {
      return res.status(400).json({ error: '搜索关键词长度必须在1-100个字符之间' });
    }
    
    // 检查是否包含危险字符
    const dangerousChars = /[<>'"&]/;
    if (dangerousChars.test(cleanKeyword)) {
      return res.status(400).json({ error: '搜索关键词包含无效字符' });
    }

    const searchTerm = `%${cleanKeyword}%`;

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
    res.status(500).json({ error: '搜索服务暂时不可用，请稍后再试' });
  }
});

// 认证相关路由
app.post('/api/auth/register',

  [
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
// app.use('/api/rights',);

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

// 使用版权实物路由
app.use('/api/rights', rightsRouter);

// 使用上传路由
app.use('/api/upload', uploadRouter);

// 全局错误处理中间件
app.use((err, req, res, next) => {
  console.error('未处理的错误:', err);
  
  // 根据错误类型返回不同的响应
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: '文件大小超过限制' });
  }
  
  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({ error: '不支持的文件类型' });
  }
  
  if (err.message && err.message.includes('文件')) {
    return res.status(400).json({ error: err.message });
  }
  
  // 默认错误响应
  res.status(500).json({ error: '服务器内部错误' });
});

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// 启动HTTPS服务器
const PORT = process.env.PORT || 2000;
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`HTTPS服务器运行在端口 ${PORT}`);
});

