#!/usr/bin/env node
/**
 * 检查 API 请求签名环境变量是否已正确配置
 * 用法：node scripts/check-api-sign-env.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const { loadApiSignClientsFromEnv, isApiSignEnabled, isApiSignEnforced } = require('../utils/apiRequestSign')

const clients = loadApiSignClientsFromEnv()
const enabled = isApiSignEnabled()
const enforced = isApiSignEnforced()

console.log('API_SIGN_ENABLED:', enabled)
console.log('API_SIGN_ENFORCE:', enforced)
console.log('API_SIGN_CLIENTS:', process.env.API_SIGN_CLIENTS ? '(set)' : '(unset)')
console.log('API_SIGN_SECRET_ADMIN_WEB:', process.env.API_SIGN_SECRET_ADMIN_WEB ? '(set)' : '(unset)')
console.log('API_SIGN_SECRET_WX_MINI:', process.env.API_SIGN_SECRET_WX_MINI ? '(set)' : '(unset)')
console.log('loaded_client_ids:', [...clients.keys()])

if (!enabled) {
  console.log('\nOK: 签名未启用')
  process.exit(0)
}

if (clients.size === 0) {
  console.error('\nERROR: 签名已启用但未加载任何客户端密钥')
  console.error('请在 .env 添加：')
  console.error('  API_SIGN_SECRET_ADMIN_WEB=<与 VITE_API_SIGN_SECRET 相同>')
  console.error('  API_SIGN_SECRET_WX_MINI=<与小程序 API_SIGN_SECRET 相同>')
  process.exit(1)
}

if (!clients.has('wx-mini')) {
  console.error('\nERROR: 缺少 wx-mini 客户端（小程序请求会报 UNKNOWN_API_KEY）')
  process.exit(1)
}

if (!clients.has('admin-web')) {
  console.warn('\nWARN: 缺少 admin-web 客户端（管理后台请求会验签失败）')
}

console.log('\nOK: 签名配置完整')
process.exit(0)
