const db = require('../db')
const logger = require('../utils/logger')
const { ensureWxCardSchema } = require('../utils/wxCardSchema')
const {
  verifyOaSignature,
  verifyOaMsgSignature,
  decryptOaMessage,
  parseWxXml,
  extractEncryptFromXml,
} = require('../utils/wxOaCrypto')
const { getOaCallbackConfig } = require('./wechatOaTokenService')

const CARD_EVENT_TYPES = new Set([
  'user_get_card',
  'user_gifting_card',
  'user_del_card',
  'user_consume_card',
  'user_pay_from_pay_cell',
  'user_view_card',
  'user_enter_session_from_card',
  'update_member_card',
  'card_sku_remind',
  'card_pay_order',
  'submit_membercard_user_info',
  'card_pass_check',
  'card_not_pass_check',
])

function pickEventFields(parsed) {
  const eventType = String(parsed.Event || parsed.MsgType || 'unknown').trim()
  return {
    eventType,
    cardId: parsed.CardId || parsed.card_id || null,
    code: parsed.UserCardCode || parsed.Code || null,
    oaOpenid: parsed.FromUserName || null,
    outerStr: parsed.OuterStr || parsed.OuterId || null,
  }
}

async function insertEventLog(row) {
  const [result] = await db.query(
    `INSERT INTO wx_card_event_log
      (event_type, card_id, code, oa_openid, outer_str, raw_body, process_status, process_error, processed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      row.eventType,
      row.cardId,
      row.code,
      row.oaOpenid,
      row.outerStr,
      row.rawBody,
      row.processStatus,
      row.processError,
      row.processedAt,
    ]
  )
  return result.insertId
}

/**
 * P0：尽量把服务号 openid 回填到已有用户（仅当该 oa_openid 尚未占用且 outer_str=uid:{id}）
 * 更完整的 unionid 关联在后续登录/领券流程补齐。
 */
async function tryBindOaOpenidFromEvent({ eventType, oaOpenid, outerStr }) {
  if (eventType !== 'user_get_card' || !oaOpenid) return null

  const outer = String(outerStr || '').trim()
  const uidMatch = /^uid:(\d+)$/i.exec(outer)
  if (!uidMatch) return null

  const userId = Number(uidMatch[1])
  if (!Number.isFinite(userId) || userId <= 0) return null

  const [existing] = await db.query(
    'SELECT id FROM wx_users WHERE oa_openid = ? AND id <> ? LIMIT 1',
    [oaOpenid, userId]
  )
  if (existing.length > 0) {
    logger.warn('oa_openid 已被其他用户占用，跳过绑定', { oaOpenid, userId, occupiedBy: existing[0].id })
    return null
  }

  await db.query(
    'UPDATE wx_users SET oa_openid = ?, updated_at = NOW() WHERE id = ? AND (oa_openid IS NULL OR oa_openid = ?)',
    [oaOpenid, userId, oaOpenid]
  )
  return userId
}

async function processParsedEvent(parsed, rawBody) {
  const fields = pickEventFields(parsed)
  let processStatus = 'pending'
  let processError = null
  let processedAt = null

  try {
    if (!CARD_EVENT_TYPES.has(fields.eventType) && fields.eventType !== 'event') {
      // 普通文本/关注等：落库后标 ignored，避免积压
      if (!String(parsed.Event || '').trim()) {
        processStatus = 'ignored'
        processedAt = new Date()
      }
    }

    if (fields.eventType === 'user_get_card') {
      await tryBindOaOpenidFromEvent(fields)
      // code↔本地券对齐留给 P1；P0 仅先存后处理
      processStatus = 'pending'
    } else if (
      fields.eventType === 'subscribe' ||
      fields.eventType === 'unsubscribe' ||
      fields.eventType === 'VIEW' ||
      fields.eventType === 'CLICK'
    ) {
      processStatus = 'ignored'
      processedAt = new Date()
    }
  } catch (err) {
    processStatus = 'failed'
    processError = String(err.message || err).slice(0, 255)
    processedAt = new Date()
    logger.error('处理卡券事件失败', { eventType: fields.eventType, err: err.message })
  }

  const id = await insertEventLog({
    ...fields,
    rawBody,
    processStatus,
    processError,
    processedAt,
  })

  return { id, ...fields, processStatus }
}

/**
 * 校验并解析微信推送，写入 wx_card_event_log
 */
async function handleOaCallbackPost({ query, bodyText }) {
  await ensureWxCardSchema()

  const config = getOaCallbackConfig()
  if (!config.enabled) {
    const err = new Error('服务号回调未启用')
    err.code = 'OA_CALLBACK_DISABLED'
    throw err
  }
  if (!config.configured) {
    const err = new Error('缺少 WECHAT_OA_APPID 或 WECHAT_OA_TOKEN')
    err.code = 'OA_CALLBACK_NOT_CONFIGURED'
    throw err
  }

  const timestamp = String(query.timestamp || '')
  const nonce = String(query.nonce || '')
  const encryptType = String(query.encrypt_type || '').toLowerCase()
  const rawBody = typeof bodyText === 'string' ? bodyText : String(bodyText || '')

  let messageXml = rawBody

  if (encryptType === 'aes' || rawBody.includes('<Encrypt>')) {
    const encrypt = extractEncryptFromXml(rawBody)
    if (!encrypt) {
      const err = new Error('安全模式消息缺少 Encrypt')
      err.code = 'OA_ENCRYPT_MISSING'
      throw err
    }
    if (!config.aesKey) {
      const err = new Error('缺少 WECHAT_OA_AES_KEY')
      err.code = 'OA_AES_KEY_MISSING'
      throw err
    }

    const msgSignature = String(query.msg_signature || '')
    if (
      !verifyOaMsgSignature({
        token: config.token,
        timestamp,
        nonce,
        encrypt,
        msgSignature,
      })
    ) {
      const err = new Error('msg_signature 校验失败')
      err.code = 'OA_MSG_SIGNATURE_INVALID'
      throw err
    }

    const decrypted = decryptOaMessage(encrypt, config.aesKey, config.appid)
    messageXml = decrypted.message
  } else {
    const signature = String(query.signature || '')
    if (
      !verifyOaSignature({
        token: config.token,
        timestamp,
        nonce,
        signature,
      })
    ) {
      const err = new Error('signature 校验失败')
      err.code = 'OA_SIGNATURE_INVALID'
      throw err
    }
  }

  const parsed = parseWxXml(messageXml)
  return processParsedEvent(parsed, messageXml)
}

/**
 * 微信后台「服务器配置」URL 验证
 */
function handleOaCallbackVerify(query) {
  const config = getOaCallbackConfig()
  if (!config.enabled) {
    const err = new Error('服务号回调未启用')
    err.code = 'OA_CALLBACK_DISABLED'
    throw err
  }
  if (!config.configured) {
    const err = new Error('缺少 WECHAT_OA_APPID 或 WECHAT_OA_TOKEN')
    err.code = 'OA_CALLBACK_NOT_CONFIGURED'
    throw err
  }

  const timestamp = String(query.timestamp || '')
  const nonce = String(query.nonce || '')
  const echostr = String(query.echostr || '')

  // 安全模式验证：echostr 为密文
  if (query.encrypt_type === 'aes' || query.msg_signature) {
    if (!config.aesKey) {
      const err = new Error('缺少 WECHAT_OA_AES_KEY')
      err.code = 'OA_AES_KEY_MISSING'
      throw err
    }
    if (
      !verifyOaMsgSignature({
        token: config.token,
        timestamp,
        nonce,
        encrypt: echostr,
        msgSignature: String(query.msg_signature || ''),
      })
    ) {
      const err = new Error('msg_signature 校验失败')
      err.code = 'OA_MSG_SIGNATURE_INVALID'
      throw err
    }
    const { message } = decryptOaMessage(echostr, config.aesKey, config.appid)
    return message
  }

  if (
    !verifyOaSignature({
      token: config.token,
      timestamp,
      nonce,
      signature: String(query.signature || ''),
    })
  ) {
    const err = new Error('signature 校验失败')
    err.code = 'OA_SIGNATURE_INVALID'
    throw err
  }

  return echostr
}

module.exports = {
  handleOaCallbackVerify,
  handleOaCallbackPost,
  CARD_EVENT_TYPES,
}
