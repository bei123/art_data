const fs = require('fs')
const path = require('path')

let cachedKeys = null

function loadWechatpayPublicKeys() {
  if (cachedKeys) return cachedKeys

  cachedKeys = {}
  const pubId = process.env.WX_PUB_ID
  if (!pubId) return cachedKeys

  const pubKeyPath = path.join(__dirname, '../ssl/pub_key.pem')
  try {
    cachedKeys[pubId] = fs.readFileSync(pubKeyPath, 'utf8')
  } catch {
    cachedKeys[pubId] = null
  }

  return cachedKeys
}

function getWechatpayPublicKey(serialOrKeyId) {
  const keys = loadWechatpayPublicKeys()
  return keys[serialOrKeyId] || null
}

module.exports = { getWechatpayPublicKey }
