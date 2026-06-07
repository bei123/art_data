const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const redisClient = require('./utils/redisClient');
const { requestContextMiddleware } = require('./middleware/requestContext');
const logger = require('./utils/logger');
const { sendErrorResponse } = require('./utils/apiErrors');
const https = require('https');
const fs = require('fs');
const { body } = require('express-validator');
const auth = require('./auth');
const { uploadToOSS } = require('./config/oss');
const { PUBLIC_API_BASE_URL } = require('./config/publicEnv');
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
const userRouter = require('./routes/user');
const searchRouter = require('./routes/search');
const externalApiRouter = require('./routes/external-api');
const issuanceRouter = require('./routes/issuance');
const assetTransferRouter = require('./routes/asset-transfer');
const assetVerifyRouter = require('./routes/asset-verify');
const transactionRouter = require('./routes/transaction');
const institutionsRouter = require('./routes/institutions');
const showcaseRouter = require('./routes/showcase');
const homeTitlesRouter = require('./routes/home-titles');
const webviewRouter = require('./routes/webview');
const exhibitionsRouter = require('./routes/exhibitions');
const { startDigitalArtworksSync } = require('./utils/digitalArtworksSync');
const { ensureOrderItemsQrCodeColumns } = require('./utils/orderItemsSchema');
const { ensureDigitalArtworkIdColumns } = require('./utils/digitalArtworkResolver');
const { startWmsProductSyncSchedule } = require('./services/wmsProductSyncService');
const {
  applyCorsHeaders,
  corsPreflightMiddleware,
  corsPolicyOrigin,
} = require('./middleware/corsPolicy');

const app = express();

/** 反向代理（宝塔/Nginx）会带 X-Forwarded-For；须开启 trust proxy 供限流与 req.ip 正确 */
function resolveTrustProxy() {
  const raw = String(process.env.TRUST_PROXY ?? '1').trim().toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  if (raw === 'true') return true;
  const n = parseInt(raw, 10);
  if (!Number.isNaN(n)) return n;
  return 1;
}
app.set('trust proxy', resolveTrustProxy());

// 微信支付回调接口必须用原始body字符串
app.use('/api/wx/pay/notify', express.raw({ type: 'application/json' }));
app.use('/api/wx/pay/refund/notify', express.raw({ type: 'application/json' }));

// CORS 与 OPTIONS 预检必须在 helmet、限流之前，否则 CDN/限流响应无 ACAO
app.use(corsPreflightMiddleware);
app.use(cors({
  origin: corsPolicyOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With', 'X-Request-Id', 'X-External-Authorization', 'x-external-authorization'],
  exposedHeaders: ['Authorization', 'X-Request-Id'],
}));

// 安全中间件配置
// 注意：webview 代理路由需要更宽松的 CSP，所以在该路由上会单独处理
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
      baseUri: ["'self'"], // 默认只允许 self
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(requestContextMiddleware);

// 速率限制配置
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1分钟
  max: 300, // 每个 IP 1 分钟内最多 300 次请求（含管理端操作，过高会失去防爬意义）
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    req.method === 'OPTIONS' ||
    (req.method === 'GET' &&
      (req.path === '/api/health' || req.path === '/api/health/live')),
  handler: (req, res) => {
    applyCorsHeaders(req, res);
    res.status(429).json({
      error: '请求过于频繁，请稍后再试',
      code: 'RATE_LIMIT',
      request_id: req.requestId || null,
    });
  },
});

// 对API路由应用速率限制
app.use('/api/', limiter);

// 对登录接口应用更严格的速率限制
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟
  max: 5, // 每个 IP 15 分钟内最多 5 次登录尝试
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: (req, res) => {
    applyCorsHeaders(req, res);
    res.status(429).json({
      error: '登录尝试过于频繁，请稍后再试',
      code: 'LOGIN_RATE_LIMIT',
      request_id: req.requestId || null,
    });
  },
});

app.use('/api/auth/login', loginLimiter);

// 为 webview 代理路由禁用 CSP（使用更宽松的 meta CSP）
// 在路由处理中会移除 CSP 头，让页面使用注入的 meta CSP

// 请求体解析（只注册一组，避免重复解析与体积异常）
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

async function apiHealthHandler(req, res) {
  const [dbHealth, redisHealth] = await Promise.all([
    db.checkPoolHealth(),
    redisClient.checkRedisHealth(),
  ]);
  const dbOk = dbHealth.healthy === true;
  const redisOk = redisHealth.ok === true;
  const ok = dbOk && redisOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    request_id: req.requestId || null,
    checks: {
      database: {
        healthy: dbOk,
        ...(dbHealth.error ? { error: dbHealth.error } : {}),
      },
      redis: redisOk
        ? {
            ok: true,
            ...(redisHealth.latency_ms != null
              ? { latency_ms: redisHealth.latency_ms }
              : {}),
          }
        : {
            ok: false,
            ...(redisHealth.error ? { error: redisHealth.error } : {}),
          },
    },
  });
}

app.get('/api/health', apiHealthHandler);
app.get('/api/health/live', apiHealthHandler);

// 静态文件服务
app.use('/uploads', express.static('uploads'));

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// SSL证书配置
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'api.wx.2000gallery.art.key')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'api.wx.2000gallery.art.pem'))
};

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

// 文件上传接口（需登录，防止匿名刷 OSS）
app.post('/api/upload', ...auth.requireAdmin, upload.single('file'), async (req, res) => {
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

// 获取用户的数字身份购买记录（本人或 admin，防止越权）
app.get(
  '/api/digital-identity/purchases/:user_id',
  auth.authenticateToken,
  async (req, res) => {
    const access = await auth.assertSelfOrAdmin(req, req.params.user_id)
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error })
    }
    try {
      await ensureOrderItemsQrCodeColumns()
      await ensureDigitalArtworkIdColumns()

      const [purchases] = await db.query(`
      SELECT 
        dip.*,
        COALESCE(da.title, dae.title) as artwork_title,
        COALESCE(da.image_url, dae.image_url) as artwork_image,
        o.trade_state as order_trade_state,
        oi.delivery_qr_code_url,
        oi.delivery_qr_code_at
      FROM digital_identity_purchases dip
      LEFT JOIN digital_artworks da ON CAST(dip.digital_artwork_id AS CHAR) = CAST(da.id AS CHAR)
      LEFT JOIN digital_artworks_external dae ON CAST(dip.digital_artwork_id AS CHAR) = dae.id
      LEFT JOIN orders o ON dip.order_id = o.id
      LEFT JOIN order_items oi ON oi.order_id = dip.order_id
        AND oi.type = 'digital'
        AND oi.digital_artwork_id = dip.digital_artwork_id
      WHERE dip.user_id = ?
      ORDER BY dip.purchase_date DESC
    `, [access.userId])

      const result = (purchases || []).map((row) => {
        const isPaid = row.order_trade_state === 'SUCCESS'
        const qrCodeUrl = isPaid && row.delivery_qr_code_url ? row.delivery_qr_code_url : null
        return {
          ...row,
          qr_code_url: qrCodeUrl,
          qr_code_uploaded_at: qrCodeUrl ? row.delivery_qr_code_at : null,
        }
      })

      res.json(result)
    } catch (error) {
      console.error('获取数字身份购买记录失败:', error)
      res.status(500).json({ error: '获取数字身份购买记录失败' })
    }
  }
)

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

// 确保订单项交付二维码字段存在
ensureOrderItemsQrCodeColumns().catch((err) => {
  logger.warn('order_items qr code columns ensure failed', { err: err.message });
});
ensureDigitalArtworkIdColumns().catch((err) => {
  logger.warn('digital_artwork_id column ensure failed', { err: err.message });
});

// 定时同步外部数字艺术品到缓存表（用于列表/影藏展示）
startDigitalArtworksSync();
// 定时从 WMS 同步原作主档（价格、艺术家、仓库图路径等）
startWmsProductSyncSchedule();

// 使用实物分类路由
app.use('/api/physical-categories', physicalCategoriesRouter);

// 使用版权实物路由
app.use('/api/rights', rightsRouter);

// 使用上传路由
app.use('/api/upload', uploadRouter);

// 使用用户路由
app.use('/api/user', userRouter);

// 使用搜索路由
app.use('/api/search', searchRouter);

// 使用外部API路由
app.use('/api/external', externalApiRouter);

// 使用发行铸造路由
app.use('/api/issuance', issuanceRouter);

// 使用资产过户路由
app.use('/api/asset-transfer', assetTransferRouter);

// 使用资产查证路由
app.use('/api/asset-verify', assetVerifyRouter);

// 使用交易记录路由
app.use('/api/transaction', transactionRouter);

// 使用机构路由
app.use('/api/institutions', institutionsRouter);
app.use('/api/showcase', showcaseRouter);

// 使用首页标题路由
app.use('/api/home-titles', homeTitlesRouter);

// 使用展览路由
app.use('/api/exhibitions', exhibitionsRouter);

// 使用WebView代理路由
app.use('/api/webview', webviewRouter);

// 全局错误处理中间件
app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }
  applyCorsHeaders(req, res);
  logger.error('unhandled_error', { err, request_id: req.requestId });
  return sendErrorResponse(res, err, req);
});

// 404处理
app.use('*', (req, res) => {
  applyCorsHeaders(req, res);
  res.status(404).json({
    error: '接口不存在',
    code: 'NOT_FOUND',
    request_id: req.requestId || null,
  });
});

// 启动HTTPS服务器
const PORT = process.env.PORT || 2000;
https.createServer(sslOptions, app).listen(PORT, () => {
  console.log(`HTTPS服务器运行在端口 ${PORT}，PUBLIC_API_BASE_URL=${PUBLIC_API_BASE_URL}`);
});

