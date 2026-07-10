const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const logger = require('../utils/logger')
const { PUBLIC_API_BASE_URL } = require('../config/publicEnv')

const WX_PAY_CONFIG = {
  appId: process.env.WX_APPID,
  mchId: process.env.WX_PAY_MCH_ID,
  serialNo: process.env.WX_PAY_SERIAL_NO,
  publicKeyId: process.env.WX_PUB_ID,
  privateKey: (() => {
    try {
      return fs.readFileSync(path.join(__dirname, '../ssl/apiclient_key.pem'))
    } catch {
      return null
    }
  })(),
  notifyUrl: process.env.WX_WITHDRAW_NOTIFY_URL
    || `${PUBLIC_API_BASE_URL}/api/wx/referral/withdraw/notify`,
}

const TRANSFER_SCENE_ID = process.env.WX_TRANSFER_SCENE_ID || '1000'
const QUERY_ON_ERROR_CODES = new Set([
  'ALREADY_EXISTS',
  'FREQUENCY_LIMIT_EXCEED',
  'RATELIMIT_EXCEEDED',
  'FREQUENCY_LIMIT',
  'SYSTEM_ERROR',
])

const TERMINAL_SUCCESS_STATES = new Set(['SUCCESS'])
const TERMINAL_FAIL_STATES = new Set(['FAIL', 'CANCELLED'])
const AWAIT_CONFIRM_STATES = new Set(['WAIT_USER_CONFIRM', 'TRANSFERING'])

function generateNonceStr() {
  return Math.random().toString(36).substring(2, 17)
}

function generateSignV3(method, urlPath, timestamp, nonceStr, body) {
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  return sign.sign(WX_PAY_CONFIG.privateKey, 'base64')
}

function buildAuthHeaders(method, urlPath, bodyObj) {
  const body = bodyObj == null ? '' : JSON.stringify(bodyObj)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = generateNonceStr()
  const signature = generateSignV3(method, urlPath, timestamp, nonceStr, body)
  return {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
      'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
    },
    body,
  }
}

function isTransferConfigured() {
  return Boolean(
    WX_PAY_CONFIG.appId
    && WX_PAY_CONFIG.mchId
    && WX_PAY_CONFIG.serialNo
    && WX_PAY_CONFIG.publicKeyId
    && WX_PAY_CONFIG.privateKey
    && String(process.env.WX_WITHDRAW_AUTO_TRANSFER || 'false').toLowerCase() === 'true'
  )
}

function normalizeTransferBill(data) {
  if (!data || typeof data !== 'object') return null
  return {
    outBillNo: data.out_bill_no || null,
    transferBillNo: data.transfer_bill_no || null,
    state: data.state || null,
    packageInfo: data.package_info || null,
    createTime: data.create_time || null,
    failReason: data.fail_reason || null,
    transferAmount: data.transfer_amount != null ? Number(data.transfer_amount) : null,
    mchId: data.mch_id || null,
    openid: data.openid || null,
    updateTime: data.update_time || null,
    raw: data,
  }
}

async function signedRequest(method, urlPath, bodyObj) {
  const { headers } = buildAuthHeaders(method, urlPath, bodyObj)
  const url = `https://api.mch.weixin.qq.com${urlPath}`
  const config = {
    method,
    url,
    headers,
    timeout: 15000,
    validateStatus: () => true,
  }
  if (method !== 'GET' && bodyObj != null) {
    config.data = bodyObj
  }
  const response = await axios(config)
  return {
    status: response.status,
    data: response.data,
  }
}

async function queryTransferByOutBillNo(outBillNo) {
  const clean = String(outBillNo || '').trim()
  if (!clean) {
    return { ok: false, error: '缺少商户单号' }
  }

  const urlPath = `/v3/fund-app/mch-transfer/transfer-bills/out-bill-no/${encodeURIComponent(clean)}`
  const result = await signedRequest('GET', urlPath, null)

  if (result.status === 200) {
    return { ok: true, bill: normalizeTransferBill(result.data) }
  }

  const wxErr = result.data || {}
  return {
    ok: false,
    error: wxErr.message || wxErr.detail || '查询转账单失败',
    code: wxErr.code || null,
    httpStatus: result.status,
  }
}

async function createTransferToWallet({
  openid,
  outBillNo,
  amountYuan,
  remark = '艺术推荐奖励提现',
}) {
  if (!isTransferConfigured()) {
    return { ok: false, manual: true, error: '微信自动转账未启用' }
  }
  if (!openid) {
    return { ok: false, error: '用户 openid 缺失' }
  }

  const amountFen = Math.round(parseFloat(amountYuan) * 100)
  if (!Number.isFinite(amountFen) || amountFen <= 0) {
    return { ok: false, error: '转账金额无效' }
  }

  const urlPath = '/v3/fund-app/mch-transfer/transfer-bills'
  const bodyObj = {
    appid: WX_PAY_CONFIG.appId,
    out_bill_no: outBillNo,
    transfer_scene_id: TRANSFER_SCENE_ID,
    openid,
    transfer_amount: amountFen,
    transfer_remark: remark.slice(0, 32),
    transfer_scene_report_infos: [
      {
        info_type: '活动名称',
        info_content: '艺术推荐官奖励',
      },
      {
        info_type: '奖励说明',
        info_content: '推荐成交奖励提现',
      },
    ],
  }

  if (WX_PAY_CONFIG.notifyUrl) {
    bodyObj.notify_url = WX_PAY_CONFIG.notifyUrl
  }

  const result = await signedRequest('POST', urlPath, bodyObj)

  if (result.status === 200) {
    const bill = normalizeTransferBill(result.data)
    return {
      ok: true,
      bill,
      transferId: bill.transferBillNo,
      state: bill.state,
      packageInfo: bill.packageInfo,
      createSuccess: bill.state === 'WAIT_USER_CONFIRM' || TERMINAL_SUCCESS_STATES.has(bill.state),
    }
  }

  const wxErr = result.data || {}
  const code = wxErr.code || null
  const shouldQuery = QUERY_ON_ERROR_CODES.has(code) || result.status >= 500

  logger.warn('wechat transfer create failed', {
    outBillNo,
    httpStatus: result.status,
    code,
    err: wxErr,
  })

  if (shouldQuery) {
    const queried = await queryTransferByOutBillNo(outBillNo)
    if (queried.ok && queried.bill) {
      return {
        ok: true,
        bill: queried.bill,
        transferId: queried.bill.transferBillNo,
        state: queried.bill.state,
        packageInfo: queried.bill.packageInfo,
        recoveredByQuery: true,
        createSuccess: AWAIT_CONFIRM_STATES.has(queried.bill.state)
          || TERMINAL_SUCCESS_STATES.has(queried.bill.state),
      }
    }
  }

  return {
    ok: false,
    error: wxErr.message || wxErr.detail || '微信转账失败',
    code,
    httpStatus: result.status,
    shouldQuery,
  }
}

function getTransferClientConfig() {
  return {
    mchId: WX_PAY_CONFIG.mchId || null,
    appId: WX_PAY_CONFIG.appId || null,
  }
}

module.exports = {
  isTransferConfigured,
  createTransferToWallet,
  queryTransferByOutBillNo,
  getTransferClientConfig,
  TERMINAL_SUCCESS_STATES,
  TERMINAL_FAIL_STATES,
  AWAIT_CONFIRM_STATES,
  normalizeTransferBill,
}
