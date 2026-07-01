const { ipKeyGenerator } = require('express-rate-limit')

/** IPv6-safe IP suffix for express-rate-limit custom keyGenerator */
function rateLimitIpKey(req) {
  return ipKeyGenerator(req.ip)
}

/** Prefer authenticated user id; otherwise IPv6-safe IP key */
function rateLimitUserOrIpKey(prefix, req) {
  const userId = req.user?.id
  if (userId != null) return `${prefix}:user:${userId}`
  return `${prefix}:ip:${rateLimitIpKey(req)}`
}

module.exports = {
  rateLimitIpKey,
  rateLimitUserOrIpKey,
}
