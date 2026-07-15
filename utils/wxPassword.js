const bcrypt = require('bcryptjs')
const crypto = require('crypto')

const BCRYPT_ROUNDS = 10

function isBcryptHash(hash) {
  return typeof hash === 'string' && hash.startsWith('$2')
}

/**
 * Legacy salted MD5 used only to verify pre-bcrypt wx_users rows.
 * Successful login upgrades the stored hash to bcrypt (see wxService.verifyPassword).
 * New passwords must use hashWxPassword (bcrypt).
 */
function legacyMd5WithSalt(password, salt, times = 3) {
  let material = String(password) + String(salt)
  for (let i = 0; i < times; i += 1) {
    // Legacy protocol digest — not used to store new passwords.
    material = crypto // codeql[js/insufficient-password-hash]
      .createHash('md5') // codeql[js/insufficient-password-hash]
      .update(material) // codeql[js/insufficient-password-hash]
      .digest('hex')
  }
  return material
}

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  if (left.length !== right.length) return false
  return crypto.timingSafeEqual(left, right)
}

async function hashWxPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS)
}

async function verifyWxPassword(password, passwordHash, salt) {
  if (!passwordHash) return false
  if (isBcryptHash(passwordHash)) {
    return bcrypt.compare(password, passwordHash)
  }
  // Non-bcrypt rows are legacy MD5+salt only.
  if (!salt) return false
  const legacy = legacyMd5WithSalt(password, salt, 3)
  return timingSafeEqualHex(legacy, passwordHash)
}

module.exports = {
  hashWxPassword,
  verifyWxPassword,
  isBcryptHash,
  legacyMd5WithSalt,
}
