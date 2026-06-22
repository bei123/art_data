/**
 * 顺丰鉴权自检：node scripts/sf-auth-test.js
 * 读取 .env 中的 SF_PARTNER_ID / SF_CHECK_WORD / SF_USE_OAUTH
 */
require('dotenv').config()
const {
  getSfConfig,
  fetchSfOAuthAccessToken,
  callSfService,
  SERVICE_CODE,
  resetSfOAuthTokenCache,
} = require('../services/sfExpressClient')

async function main() {
  const cfg = getSfConfig()
  console.log('config:', {
    partnerId: cfg.partnerId ? `${cfg.partnerId.slice(0, 4)}***` : '(empty)',
    authMode: cfg.authMode,
    baseUrl: cfg.baseUrl,
    hasCheckWord: Boolean(cfg.checkWord),
    hasOauthSecret: Boolean(cfg.oauthSecret),
    isSandbox: cfg.isSandbox,
  })

  if (!cfg.partnerId) {
    console.error('缺少 SF_PARTNER_ID')
    process.exit(1)
  }

  if (cfg.authMode === 'oauth2-fetch' || process.argv.includes('--oauth')) {
    resetSfOAuthTokenCache()
    const oauth = await fetchSfOAuthAccessToken(cfg)
    console.log('oauth:', oauth.ok ? `ok expiresIn=${oauth.expiresIn}s` : oauth)
    if (!oauth.ok) process.exit(1)
  }

  const probe = await callSfService(SERVICE_CODE.QUERY_DELIVERTM, {
    destAddress: { province: '广东省', city: '深圳市', district: '福田区' },
    srcAddress: { province: '广东省', city: '广州市', district: '天河区' },
    searchPrice: '0',
    weight: 1,
  })

  if (probe.ok) {
    console.log('api probe: ok', probe.msgData ? '(has msgData)' : '')
    return
  }

  console.error('api probe failed:', {
    error: probe.error,
    apiResultCode: probe.apiResultCode,
    sf_error: probe.sf_error,
  })
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
