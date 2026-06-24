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

function generateNonceStr() {
  return Math.random().toString(36).substring(2, 17)
}

function generateSignV3(method, urlPath, timestamp, nonceStr, body) {
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonceStr}\n${body}\n`
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(message)
  return sign.sign(WX_PAY_CONFIG.privateKey, 'base64')
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
    transfer_remark: remark,
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

  const body = JSON.stringify(bodyObj)
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const nonceStr = generateNonceStr()
  const signature = generateSignV3('POST', urlPath, timestamp, nonceStr, body)

  try {
    const response = await axios.post(`https://api.mch.weixin.qq.com${urlPath}`, bodyObj, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `WECHATPAY2-SHA256-RSA2048 mchid="${WX_PAY_CONFIG.mchId}",nonce_str="${nonceStr}",signature="${signature}",timestamp="${timestamp}",serial_no="${WX_PAY_CONFIG.serialNo}"`,
        'Wechatpay-Serial': WX_PAY_CONFIG.publicKeyId,
      },
      timeout: 15000,
    })

    return {
      ok: true,
      transferId: response.data?.transfer_bill_no || response.data?.batch_id || null,
      state: response.data?.state || 'PROCESSING',
      raw: response.data,
    }
  } catch (err) {
    const wxErr = err?.response?.data
    logger.warn('wechat transfer failed', {
      outBillNo,
      err: wxErr || err.message,
    })
    return {
      ok: false,
      error: wxErr?.message || wxErr?.detail || err.message || '微信转账失败',
      code: wxErr?.code || null,
    }
  }
}

module.exports = {
  isTransferConfigured,
  createTransferToWallet,
}
