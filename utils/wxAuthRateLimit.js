const rateLimit = require('express-rate-limit')
const { applyCorsHeaders } = require('../middleware/corsPolicy')

function buildWxRateLimitHandler(code, message) {
  return (req, res) => {
    applyCorsHeaders(req, res)
    res.status(429).json({
      error: message,
      code,
      request_id: req.requestId || null,
    })
  }
}

const wxLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.WX_LOGIN_RATE_LIMIT_PER_15MIN || '30', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: buildWxRateLimitHandler('WX_LOGIN_RATE_LIMIT', '登录过于频繁，请稍后再试'),
})

const wxRefreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.WX_REFRESH_RATE_LIMIT_PER_15MIN || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: buildWxRateLimitHandler('WX_REFRESH_RATE_LIMIT', '刷新登录状态过于频繁，请稍后再试'),
})

const wxPublicAuxLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: parseInt(process.env.WX_PUBLIC_AUX_RATE_LIMIT_PER_MIN || '60', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
  handler: buildWxRateLimitHandler('WX_PUBLIC_AUX_RATE_LIMIT', '请求过于频繁，请稍后再试'),
})

module.exports = {
  wxLoginLimiter,
  wxRefreshLimiter,
  wxPublicAuxLimiter,
}
