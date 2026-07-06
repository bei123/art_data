const https = require('https')
const axios = require('axios')

let insecureAgent

function isWespaceTlsInsecure() {
  const raw = String(
    process.env.WESPACE_NODE_TLS_INSECURE ?? process.env.EXTERNAL_API_TLS_INSECURE ?? 'false'
  )
    .trim()
    .toLowerCase()
  return raw === 'true' || raw === '1'
}

function getWespaceHttpsAgent() {
  if (!isWespaceTlsInsecure()) return undefined
  if (!insecureAgent) {
    insecureAgent = new https.Agent({ rejectUnauthorized: false })
  }
  return insecureAgent
}

function withWespaceTls(config = {}) {
  const agent = getWespaceHttpsAgent()
  if (!agent) return config
  return { ...config, httpsAgent: agent }
}

const wespaceAxios = axios.create()
if (isWespaceTlsInsecure()) {
  wespaceAxios.defaults.httpsAgent = getWespaceHttpsAgent()
}

module.exports = {
  isWespaceTlsInsecure,
  getWespaceHttpsAgent,
  withWespaceTls,
  wespaceAxios,
}
