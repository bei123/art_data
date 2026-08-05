const crypto = require('crypto')

/**
 * 外部系统回调鉴权（共享密钥，勿与 Bearer JWT 混用）
 * 仅接受请求头；禁止 query secret（易进访问日志 / Referer）
 */
function readWebhookSecret(envName) {
  const name = envName || 'INTEGRATION_WEBHOOK_SECRET'
  const value = process.env[name] || process.env.INTEGRATION_WEBHOOK_SECRET
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function timingSafeEqualString(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

function verifyIntegrationWebhook({ envName } = {}) {
  return function verifyIntegrationWebhookMiddleware(req, res, next) {
    const expected = readWebhookSecret(envName)
    if (!expected) {
      return res.status(503).json({ error: 'Webhook 密钥未配置' })
    }
    const headerSecret = req.headers['x-webhook-secret'] || req.headers['x-integration-webhook-secret']
    const provided = headerSecret != null ? String(headerSecret) : ''
    if (!provided || !timingSafeEqualString(provided, expected)) {
      return res.status(401).json({ error: 'Webhook 鉴权失败' })
    }
    return next()
  }
}

module.exports = {
  readWebhookSecret,
  verifyIntegrationWebhook,
}
