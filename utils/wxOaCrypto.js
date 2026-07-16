const crypto = require('crypto')

/**
 * 微信服务号消息验签 / 加解密（明文 + 安全模式）
 * @see https://developers.weixin.qq.com/doc/service/guide/dev/push.html
 */

function sha1Hex(input) {
  return crypto.createHash('sha1').update(input, 'utf8').digest('hex')
}

function sortJoin(parts) {
  return [...parts].map(String).sort().join('')
}

/** 服务器 URL 验证 / 明文消息签名 */
function buildOaSignature({ token, timestamp, nonce }) {
  return sha1Hex(sortJoin([token, timestamp, nonce]))
}

/** 安全模式 msg_signature（含 Encrypt 字段） */
function buildOaMsgSignature({ token, timestamp, nonce, encrypt }) {
  return sha1Hex(sortJoin([token, timestamp, nonce, encrypt]))
}

function timingSafeEqualHex(a, b) {
  const left = String(a || '')
  const right = String(b || '')
  if (!left || !right || left.length !== right.length) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
  } catch {
    return false
  }
}

function verifyOaSignature({ token, timestamp, nonce, signature }) {
  const expected = buildOaSignature({ token, timestamp, nonce })
  return timingSafeEqualHex(expected, signature)
}

function verifyOaMsgSignature({ token, timestamp, nonce, encrypt, msgSignature }) {
  const expected = buildOaMsgSignature({ token, timestamp, nonce, encrypt })
  return timingSafeEqualHex(expected, msgSignature)
}

function decodeAesKey(encodingAesKey) {
  const key = String(encodingAesKey || '').trim()
  if (key.length !== 43) {
    throw new Error('WECHAT_OA_AES_KEY 须为 43 位 EncodingAESKey')
  }
  return Buffer.from(`${key}=`, 'base64')
}

function pkcs7Unpad(buf) {
  if (!buf.length) throw new Error('empty cipher payload')
  const pad = buf[buf.length - 1]
  if (pad < 1 || pad > 32) throw new Error('invalid pkcs7 padding')
  return buf.subarray(0, buf.length - pad)
}

function pkcs7Pad(buf, blockSize = 32) {
  const amount = blockSize - (buf.length % blockSize)
  return Buffer.concat([buf, Buffer.alloc(amount, amount)])
}

/**
 * 解密微信安全模式密文，返回明文 XML/文本
 * @returns {{ message: string, appId: string }}
 */
function decryptOaMessage(encrypt, encodingAesKey, expectedAppId) {
  const aesKey = decodeAesKey(encodingAesKey)
  const iv = aesKey.subarray(0, 16)
  const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv)
  decipher.setAutoPadding(false)
  const decrypted = pkcs7Unpad(
    Buffer.concat([decipher.update(Buffer.from(encrypt, 'base64')), decipher.final()])
  )

  const msgLen = decrypted.readUInt32BE(16)
  const message = decrypted.subarray(20, 20 + msgLen).toString('utf8')
  const appId = decrypted.subarray(20 + msgLen).toString('utf8')

  if (expectedAppId && appId !== expectedAppId) {
    throw new Error('解密后 AppID 与 WECHAT_OA_APPID 不一致')
  }

  return { message, appId }
}

/**
 * 解析微信推送的扁平 XML（支持 CDATA 与普通文本节点）
 */
function parseWxXml(xml) {
  const raw = String(xml || '')
  const result = {}
  const tagRe = /<([A-Za-z0-9_]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g
  let match
  while ((match = tagRe.exec(raw)) != null) {
    const key = match[1]
    if (key === 'xml') continue
    result[key] = match[2] != null ? match[2] : String(match[3] ?? '')
  }
  return result
}

function extractEncryptFromXml(xml) {
  const parsed = parseWxXml(xml)
  return parsed.Encrypt || ''
}

module.exports = {
  buildOaSignature,
  buildOaMsgSignature,
  verifyOaSignature,
  verifyOaMsgSignature,
  decryptOaMessage,
  parseWxXml,
  extractEncryptFromXml,
}
