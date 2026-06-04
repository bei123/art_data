const logger = require('../utils/logger');

function parseExtraCorsOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

function getAllowedCorsOrigins() {
  const base = [
    'http://localhost:5173',
    'https://wx.ht.2000gallery.art',
    'http://wx.ht.2000gallery.art',
    'https://www.wx.ht.2000gallery.art',
    'http://www.wx.ht.2000gallery.art',
    'https://m.wespace.cn',
    'http://m.wespace.cn',
  ];
  return [...new Set([...base, ...parseExtraCorsOrigins()])];
}

/** 允许 2000gallery.art 子域（管理台、H5 等） */
function isOriginAllowed(origin) {
  if (!origin || typeof origin !== 'string') return false;
  if (getAllowedCorsOrigins().includes(origin)) return true;
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'https:' && protocol !== 'http:') return false;
    return (
      hostname === '2000gallery.art' ||
      hostname.endsWith('.2000gallery.art')
    );
  } catch {
    return false;
  }
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!origin || !isOriginAllowed(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
  return true;
}

function corsPreflightMiddleware(req, res, next) {
  if (req.method !== 'OPTIONS') return next();
  if (!applyCorsHeaders(req, res)) {
    return res.status(403).end();
  }
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET, POST, PUT, DELETE, OPTIONS, PATCH'
  );
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Accept, Origin, X-Requested-With, X-Request-Id, X-External-Authorization, x-external-authorization'
  );
  res.setHeader('Access-Control-Max-Age', '86400');
  return res.status(204).end();
}

function corsPolicyOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (isOriginAllowed(origin)) return callback(null, origin);
  logger.warn('cors_rejected', { origin });
  return callback(null, false);
}

/** 错误/异常路径也显式带上 CORS（避免仅依赖 cors 包时边缘情况缺 ACAO） */
function respondJson(req, res, status, body) {
  applyCorsHeaders(req, res);
  return res.status(status).json(body);
}

module.exports = {
  getAllowedCorsOrigins,
  isOriginAllowed,
  applyCorsHeaders,
  corsPreflightMiddleware,
  corsPolicyOrigin,
  respondJson,
};
