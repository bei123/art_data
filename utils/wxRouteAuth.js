/**
 * 小程序需登录接口：路由层统一鉴权（service 内仍保留 resolveWxSession 作为二次校验）
 * 必须拒绝后台 admin JWT，避免 users.id 与 wx_users.id 撞号导致水平越权。
 */
const { authenticateToken } = require('../auth')

function requireWxUser(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: '未提供认证token' })
  }
  if (!req.user.is_wx_user || !req.user.openid) {
    return res.status(403).json({ error: '仅小程序用户可访问' })
  }
  return next()
}

const wxAuthenticated = [authenticateToken, requireWxUser]

module.exports = {
  wxAuthenticated,
  requireWxUser,
}
