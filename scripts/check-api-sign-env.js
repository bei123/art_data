#!/usr/bin/env node
/**
 * 检查 API 请求签名环境变量是否已正确配置
 * 用法：node scripts/check-api-sign-env.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') })

const {
  loadApiSignClientsFromEnv,
  isApiSignEnabled,
  getApiSignEnforceMode,
} = require('../utils/apiRequestSign')

const clients = loadApiSignClientsFromEnv()
const enabled = isApiSignEnabled()
const enforceMode = getApiSignEnforceMode()

console.log('API_SIGN_ENABLED:', enabled)
console.log('API_SIGN_ENFORCE:', process.env.API_SIGN_ENFORCE ?? '(unset)')
console.log('API_SIGN_ENFORCE_WRITES:', process.env.API_SIGN_ENFORCE_WRITES ?? '(unset)')
console.log('enforce_mode:', enforceMode)
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

const viteAdminSecret = String(process.env.VITE_API_SIGN_SECRET || '').trim()
if (!viteAdminSecret) {
  console.warn('\nWARN: VITE_API_SIGN_SECRET 未配置，管理端 build/dev 不会发送签名头')
} else if (!clients.get('admin-web')?.includes(viteAdminSecret)) {
  console.warn('\nWARN: VITE_API_SIGN_SECRET 与 API_SIGN_SECRET_ADMIN_WEB 不一致，管理端验签会失败')
}

if (enforceMode === 'off') {
  console.warn('\nWARN: 当前为 shadow 模式（验签失败不拦截）')
} else if (enforceMode === 'writes') {
  console.log('\nOK: Phase 3 — 写接口强制验签，读接口 shadow')
} else {
  console.log('\nOK: Phase 4 — 全量强制验签')
}

console.log('OK: 签名配置完整')
process.exit(0)
