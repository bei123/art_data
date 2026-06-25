/**
 * 后台公开注册开关：默认关闭，仅当 ALLOW_PUBLIC_ADMIN_REGISTER=true 时允许 POST /api/auth/register
 */
function isPublicAdminRegisterAllowed() {
  const raw = String(process.env.ALLOW_PUBLIC_ADMIN_REGISTER || '').trim().toLowerCase()
  return raw === 'true' || raw === '1' || raw === 'yes'
}

function requirePublicAdminRegisterEnabled(req, res, next) {
  if (isPublicAdminRegisterAllowed()) return next()
  return res.status(403).json({
    error: '公开注册已关闭，请联系管理员创建账号',
    code: 'REGISTER_DISABLED',
  })
}

module.exports = {
  isPublicAdminRegisterAllowed,
  requirePublicAdminRegisterEnabled,
}
