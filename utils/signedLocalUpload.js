const crypto = require('crypto')
const { JWT_SECRET } = require('./sessionAuth')
const { PUBLIC_API_BASE_URL } = require('../config/publicEnv')
const { toUploadRelativePath } = require('./localUploadPath')

const LOCAL_UPLOAD_SIGN_TTL_SECONDS = (() => {
  const n = parseInt(String(process.env.LOCAL_UPLOAD_SIGN_TTL_SECONDS || '3600'), 10)
  return Number.isFinite(n) && n >= 60 && n <= 86400 ? n : 3600
})()

function buildSignaturePayload(relativePath, exp) {
  return `${relativePath}:${exp}`
}

function signLocalUploadPath(urlOrPath) {
  const relativePath = toUploadRelativePath(urlOrPath)
  if (!relativePath) return urlOrPath

  const exp = Math.floor(Date.now() / 1000) + LOCAL_UPLOAD_SIGN_TTL_SECONDS
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(buildSignaturePayload(relativePath, exp))
    .digest('hex')

  const query = new URLSearchParams({ exp: String(exp), sig })
  return `${PUBLIC_API_BASE_URL}${relativePath}?${query}`
}

function verifyLocalUploadSignature(relativePath, expRaw, sigRaw) {
  const normalized = toUploadRelativePath(relativePath)
  if (!normalized || !expRaw || !sigRaw) return false

  const exp = Number(expRaw)
  if (!Number.isFinite(exp) || exp <= Math.floor(Date.now() / 1000)) return false

  const expected = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(buildSignaturePayload(normalized, exp))
    .digest('hex')

  const provided = String(sigRaw)
  if (provided.length !== expected.length) return false

  return crypto.timingSafeEqual(Buffer.from(provided, 'utf8'), Buffer.from(expected, 'utf8'))
}

module.exports = {
  LOCAL_UPLOAD_SIGN_TTL_SECONDS,
  signLocalUploadPath,
  verifyLocalUploadSignature,
}
