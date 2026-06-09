/**
 * 在服务器上检查 WMS 环境变量是否可读（不打印密码明文）
 * 用法：node scripts/check-wms-env.js
 * 需在项目根目录，且 .env 已配置
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const {
  WMS_HTTP_BASE_URL,
  WMS_HTTP_USER,
  isWmsLoginConfigured,
} = require('../config/wmsHttp')
const { assertWmsLoginEnvConfigured, wmsUserLoginFromEnv } = require('../utils/wmsHttpClient')

async function main() {
  console.log('WMS_HTTP_BASE_URL:', WMS_HTTP_BASE_URL || '(未设置)')
  console.log('WMS_HTTP_USER:', WMS_HTTP_USER ? `"${WMS_HTTP_USER}"` : '(未设置)')
  console.log('WMS_HTTP_PASSWORD:', isWmsLoginConfigured() ? '(已设置)' : '(未设置)')
  console.log('isWmsLoginConfigured:', isWmsLoginConfigured())

  if (!isWmsLoginConfigured()) {
    console.log('\n结论: 请补全 .env 后重启 Node 进程。宝塔日志里 libcurl 且 user= 多为外部探测，不是本程序。')
    process.exit(1)
  }

  console.log('\n尝试 WMS 登录…')
  try {
    const { response, sessionCookie } = await wmsUserLoginFromEnv()
    const body = response && response.data
    if (body && body.error_code === 0) {
      console.log('登录成功，error_code=0')
      process.exit(0)
    }
    console.log('登录失败 HTTP', response && response.status, body)
    process.exit(2)
  } catch (e) {
    console.log('登录异常:', e.message, e.code || '')
    process.exit(3)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(4)
})
