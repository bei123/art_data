const fs = require('fs')
const path = require('path')

let cachedKeys = null

function readPemFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

function loadExtraCertsFromEnv() {
  const raw = process.env.WX_PAY_PLATFORM_CERTS
  if (!raw || !String(raw).trim()) return

  let list
  try {
    list = JSON.parse(raw)
  } catch {
    return
  }
  if (!Array.isArray(list)) return

  for (const item of list) {
    if (!item?.serial || !item?.pemPath) continue
    const pem = readPemFile(path.resolve(String(item.pemPath)))
    if (pem) cachedKeys[item.serial] = pem
  }
}

function loadExtraCertsFromDirectory() {
  const extraDir = path.join(__dirname, '../ssl/platform-certs')
  if (!fs.existsSync(extraDir)) return

  for (const file of fs.readdirSync(extraDir)) {
    if (!file.endsWith('.pem')) continue
    const serial = file.replace(/\.pem$/, '')
    const pem = readPemFile(path.join(extraDir, file))
    if (pem) cachedKeys[serial] = pem
  }
}

function loadWechatpayPublicKeys() {
  if (cachedKeys) return cachedKeys

  cachedKeys = {}
  const pubId = process.env.WX_PUB_ID
  if (pubId) {
    const pubKeyPath =
      process.env.WX_PAY_PLATFORM_PUB_KEY_PATH
      || path.join(__dirname, '../ssl/pub_key.pem')
    cachedKeys[pubId] = readPemFile(pubKeyPath)
  }

  loadExtraCertsFromDirectory()
  loadExtraCertsFromEnv()

  return cachedKeys
}

function getWechatpayPublicKey(serialOrKeyId) {
  const keys = loadWechatpayPublicKeys()
  return keys[serialOrKeyId] || null
}

module.exports = { getWechatpayPublicKey, loadWechatpayPublicKeys }
