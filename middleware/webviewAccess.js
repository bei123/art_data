const { extractBearerToken, authenticateToken } = require('../auth')
const { verifyUrlAccessToken } = require('../utils/urlAccessToken')
const { validateProxyTargetUrl } = require('../utils/proxyUrlPolicy')
const db = require('../db')
const logger = require('../utils/logger')

async function attachUserFromUserId(req, userId) {
  const [users] = await db.query('SELECT * FROM users WHERE id = ?', [userId])
  if (users.length > 0) {
    req.user = users[0]
    return true
  }

  const [wxUsers] = await db.query(
    'SELECT id, openid, nickname, avatar, phone, created_at, updated_at FROM wx_users WHERE id = ?',
    [userId]
  )
  if (wxUsers.length > 0) {
    req.user = { ...wxUsers[0], is_wx_user: true }
    return true
  }

  return false
}

/**
 * WebView：Authorization 头 或 query.access（短期，绑定 targetUrl）
 * 禁止 query.token 传递完整登录 JWT
 */
async function authenticateWebviewAccess(req, res, next) {
  const bearer = extractBearerToken(req.headers.authorization)
  if (bearer) {
    return authenticateToken(req, res, next)
  }

  if (req.query?.token) {
    return res.status(401).json({
      code: 401,
      status: false,
      message: '请使用短期 access 参数，勿在 URL 中传递登录 token',
    })
  }

  const rawAccess = String(req.query?.access || '').trim()
  if (!rawAccess) {
    return res.status(401).json({
      code: 401,
      status: false,
      message: '未登录',
    })
  }

  if (!req.query?.targetUrl) {
    return res.status(400).json({
      code: 400,
      status: false,
      message: 'targetUrl参数不能为空',
    })
  }

  let decodedTargetUrl
  try {
    decodedTargetUrl = decodeURIComponent(String(req.query.targetUrl))
  } catch {
    return res.status(400).json({
      code: 400,
      status: false,
      message: 'targetUrl解码失败',
    })
  }

  const urlCheck = validateProxyTargetUrl(decodedTargetUrl)
  if (!urlCheck.ok) {
    return res.status(urlCheck.status).json({
      code: urlCheck.status,
      status: false,
      message: urlCheck.message,
    })
  }

  try {
    const verified = await verifyUrlAccessToken(rawAccess, {
      purpose: 'webview_proxy',
      claims: { targetUrl: urlCheck.url },
    })
    if (!verified.ok) {
      return res.status(verified.status).json({
        code: verified.status,
        status: false,
        message: verified.error,
      })
    }

    const loaded = await attachUserFromUserId(req, verified.userId)
    if (!loaded) {
      return res.status(401).json({
        code: 401,
        status: false,
        message: '用户不存在',
      })
    }

    return next()
  } catch (error) {
    logger.error('authenticateWebviewAccess', { err: error })
    return res.status(500).json({
      code: 500,
      status: false,
      message: '认证服务暂时不可用',
    })
  }
}

module.exports = {
  authenticateWebviewAccess,
}
