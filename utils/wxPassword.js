const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const BCRYPT_ROUNDS = 10;

function isBcryptHash(hash) {
  return typeof hash === 'string' && hash.startsWith('$2');
}

function legacyMd5WithSalt(password, salt, times = 3) {
  let hash = password + salt;
  for (let i = 0; i < times; i++) {
    hash = crypto.createHash('md5').update(hash).digest('hex');
  }
  return hash;
}

async function hashWxPassword(password) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyWxPassword(password, passwordHash, salt) {
  if (!passwordHash) return false;
  if (isBcryptHash(passwordHash)) {
    return bcrypt.compare(password, passwordHash);
  }
  if (!salt) return false;
  return legacyMd5WithSalt(password, salt, 3) === passwordHash;
}

module.exports = {
  hashWxPassword,
  verifyWxPassword,
  isBcryptHash,
  legacyMd5WithSalt,
};
