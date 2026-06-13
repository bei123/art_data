const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');
const {
  runHealthChecks,
  buildLiveResponse,
  buildPublicReadinessResponse,
  buildDetailedHealthResponse,
  logDegradedHealth,
} = require('./utils/healthCheck');
const { requestContextMiddleware } = require('./middleware/requestContext');
const logger = require('./utils/logger');
const { sendErrorResponse } = require('./utils/apiErrors');
const https = require('https');
const fs = require('fs');
const { body } = require('express-validator');
const auth = require('./auth');
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
const dashboardRouter = require('./routes/dashboard');
const { startDigitalArtworksSync } = require('./utils/digitalArtworksSync');
const { ensureOrderItemsQrCodeColumns } = require('./utils/orderItemsSchema');
const { ensureDigitalArtworkIdColumns } = require('./utils/digitalArtworkResolver');
const { startWmsProductSyncSchedule } = require('./services/wmsProductSyncService');
const { startPaymentPendingReminderScheduler } = require('./services/subscribeMessageNotify');
const { startLogisticsPathNotifyScheduler } = require('./services/logisticsPathNotify');
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

const uploadsLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    applyCorsHeaders(req, res);
    res.status(429).json({
      error: '文件访问过于频繁，请稍后再试',
      code: 'UPLOADS_RATE_LIMIT',
      request_id: req.requestId || null,
    });
  },
});

// 为 webview 代理路由禁用 CSP（使用更宽松的 meta CSP）
// 在路由处理中会移除 CSP 头，让页面使用注入的 meta CSP

// 请求体解析（只注册一组，避免重复解析与体积异常）
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

async function apiLiveHandler(req, res) {
  res.status(200).json(buildLiveResponse())
}

async function apiReadinessHandler(req, res) {
  const result = await runHealthChecks()
  logDegradedHealth(result)
  res
    .status(result.ok ? 200 : 503)
    .json(buildPublicReadinessResponse(result))
}

async function apiDetailedHealthHandler(req, res) {
  const result = await runHealthChecks()
  logDegradedHealth(result)
  res
    .status(result.ok ? 200 : 503)
    .json(buildDetailedHealthResponse(result, req))
}

app.get('/api/health/live', apiLiveHandler);
app.get('/api/health', apiReadinessHandler);
app.get('/api/admin/health', ...auth.requireAdmin, apiDetailedHealthHandler);

// 本地上传目录（非公开静态；经签名 URL 或登录后访问）
const { serveLocalUpload } = require('./middleware/localUploads');
const localUploadsRouter = express.Router();
localUploadsRouter.get('*', serveLocalUpload);
app.use('/uploads', uploadsLimiter, localUploadsRouter);

// 创建上传目录
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// SSL证书配置
const sslOptions = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'api.wx.2000gallery.art.key')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'api.wx.2000gallery.art.pem'))
};

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

app.post('/api/auth/url-access', auth.authenticateToken, async (req, res) => {
  const { mintUrlAccessToken } = require('./utils/urlAccessToken');
  const { validateProxyTargetUrl } = require('./utils/proxyUrlPolicy');

  const sessionToken = auth.extractBearerToken(req.headers.authorization);
  if (!sessionToken) {
    return res.status(401).json({ error: '未提供认证token' });
  }

  const { purpose, targetUrl, filePath } = req.body || {};

  if (purpose === 'local_upload') {
    if (req.user?.is_wx_user) {
      return res.status(403).json({ error: '权限不足' });
    }

    const [userRoles] = await db.query(
      'SELECT r.name FROM roles r JOIN users u ON r.id = u.role_id WHERE u.id = ?',
      [req.user.id]
    );
    if (userRoles.length === 0 || userRoles[0].name !== 'admin') {
      return res.status(403).json({ error: '权限不足' });
    }

    const { toUploadRelativePath } = require('./utils/localUploadPath');
    const normalizedPath = toUploadRelativePath(filePath);
    if (!normalizedPath) {
      return res.status(400).json({ error: 'filePath 无效' });
    }

    try {
      const result = await mintUrlAccessToken(sessionToken, {
        purpose: 'local_upload',
        claims: { filePath: normalizedPath },
      });
      if (!result.ok) {
        return res.status(result.status).json({ error: result.error });
      }
      return res.json({
        access: result.access,
        expiresIn: result.expiresIn,
      });
    } catch (error) {
      logger.error('mint_local_upload_access_failed', { err: error });
      return res.status(500).json({ error: '签发 access 失败' });
    }
  }

  if (purpose !== 'webview_proxy') {
    return res.status(400).json({ error: '不支持的 purpose' });
  }
  if (!targetUrl || typeof targetUrl !== 'string' || !targetUrl.trim()) {
    return res.status(400).json({ error: 'targetUrl 不能为空' });
  }

  let decodedTargetUrl;
  try {
    decodedTargetUrl = decodeURIComponent(targetUrl.trim());
  } catch {
    return res.status(400).json({ error: 'targetUrl 格式无效' });
  }

  const urlCheck = validateProxyTargetUrl(decodedTargetUrl);
  if (!urlCheck.ok) {
    return res.status(urlCheck.status).json({ error: urlCheck.message });
  }

  try {
    const result = await mintUrlAccessToken(sessionToken, {
      purpose: 'webview_proxy',
      claims: { targetUrl: urlCheck.url },
    });
    if (!result.ok) {
      return res.status(result.status).json({ error: result.error });
    }
    return res.json({
      access: result.access,
      expiresIn: result.expiresIn,
    });
  } catch (error) {
    logger.error('mint_url_access_failed', { err: error });
    return res.status(500).json({ error: '签发 access 失败' });
  }
});

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
// 待付款订阅消息：截止前 N 分钟扫描 Redis 排期并发送
startPaymentPendingReminderScheduler();
startLogisticsPathNotifyScheduler();

// 使用仪表盘路由
app.use('/api/dashboard', dashboardRouter);

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

