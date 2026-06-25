/**
 * 外部系统回调鉴权（共享密钥，勿与 Bearer JWT 混用）
 */
function readWebhookSecret(envName) {
  const name = envName || 'INTEGRATION_WEBHOOK_SECRET'
  const value = process.env[name] || process.env.INTEGRATION_WEBHOOK_SECRET
  if (!value || typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function verifyIntegrationWebhook({ envName } = {}) {
  return function verifyIntegrationWebhookMiddleware(req, res, next) {
    const expected = readWebhookSecret(envName)
    if (!expected) {
      return res.status(503).json({ error: 'Webhook 密钥未配置' })
    }
    const headerSecret = req.headers['x-webhook-secret'] || req.headers['x-integration-webhook-secret']
    const querySecret = req.query?.secret
    const provided = headerSecret != null ? String(headerSecret) : querySecret != null ? String(querySecret) : ''
    if (!provided || provided !== expected) {
      return res.status(401).json({ error: 'Webhook 鉴权失败' })
    }
    return next()
  }
}

module.exports = {
  readWebhookSecret,
  verifyIntegrationWebhook,
}
