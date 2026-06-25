/**
 * 小程序需登录接口：路由层统一鉴权（service 内仍保留 resolveWxSession 作为二次校验）
 */
const { authenticateToken } = require('../auth')

const wxAuthenticated = [authenticateToken]

module.exports = {
  wxAuthenticated,
}
