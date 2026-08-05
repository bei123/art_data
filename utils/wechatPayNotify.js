const crypto = require('crypto')
const { getWechatpayPublicKey } = require('./wechatpayCerts')

const APIV3_KEY = process.env.WX_PAY_KEY

function getNotifyBodyString(req) {
  if (req.body instanceof Buffer) return req.body.toString('utf8')
  if (typeof req.body === 'string') return req.body
  return JSON.stringify(req.body || {})
}

function verifyWechatpaySignature({ serial, signature, timestamp, nonce, body }) {
  if (!serial || !signature || !timestamp || !nonce || body == null) return false

  // 签名探测流量：带此前缀的签名必然验签失败，应按失败应答（4xx/5xx）等待微信重试真实通知
  if (String(signature).startsWith('WECHATPAY/SIGNTEST/')) return false

  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const skewSec = Math.abs(Math.floor(Date.now() / 1000) - ts)
  const maxSkewSec = Math.max(60, parseInt(process.env.WX_PAY_NOTIFY_MAX_SKEW_SEC || '300', 10) || 300)
  if (skewSec > maxSkewSec) return false

  const publicKey = getWechatpayPublicKey(serial)
  if (!publicKey) return false

  const message = `${timestamp}\n${nonce}\n${body}\n`
  const verify = crypto.createVerify('RSA-SHA256')
  verify.update(message)
  verify.end()
  return verify.verify(publicKey, signature, 'base64')
}

function decryptCallbackResource(resource, apiV3Key = APIV3_KEY) {
  if (!apiV3Key) {
    throw new Error('APIv3密钥未配置')
  }
  if (!resource || !resource.ciphertext || !resource.nonce) {
    throw new Error('回调 resource 缺少必要字段')
  }

  const key = Buffer.from(apiV3Key, 'utf8')
  const nonceBuf = Buffer.from(resource.nonce, 'utf8')
  const data = Buffer.from(resource.ciphertext, 'base64')
  const authTag = data.subarray(data.length - 16)
  const encrypted = data.subarray(0, data.length - 16)

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonceBuf)
  if (resource.associated_data) {
    decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'))
  }
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted)
  decrypted = Buffer.concat([decrypted, decipher.final()])
  return decrypted.toString('utf8')
}

function parseAndVerifyWechatPayNotify(req) {
  const body = getNotifyBodyString(req)

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    return { ok: false, status: 400, error: '回调数据解析失败' }
  }

  const timestamp = req.headers['wechatpay-timestamp']
  const nonce = req.headers['wechatpay-nonce']
  const signature = req.headers['wechatpay-signature']
  const serial = req.headers['wechatpay-serial']

  if (String(signature || '').startsWith('WECHATPAY/SIGNTEST/')) {
    return { ok: false, status: 401, error: '签名验证失败', signTest: true }
  }

  if (!verifyWechatpaySignature({ serial, signature, timestamp, nonce, body })) {
    return { ok: false, status: 401, error: '签名验证失败' }
  }

  return { ok: true, body, payload }
}

function decryptWechatPayNotifyPayload(payload, apiV3Key = APIV3_KEY) {
  const plaintext = decryptCallbackResource(payload.resource, apiV3Key)
  return JSON.parse(plaintext)
}

function notifySuccessResult() {
  return { ok: true, status: 204, noContent: true }
}

function notifyFailResult(status, message) {
  return {
    ok: false,
    status: status || 500,
    body: { code: 'FAIL', message: message || '失败' },
  }
}

module.exports = {
  getNotifyBodyString,
  verifyWechatpaySignature,
  decryptCallbackResource,
  parseAndVerifyWechatPayNotify,
  decryptWechatPayNotifyPayload,
  notifySuccessResult,
  notifyFailResult,
}
