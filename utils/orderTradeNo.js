const crypto = require('crypto')

function buildUserBoundOutTradeNoPrefix(userId) {
  const uid = Number(userId)
  if (!Number.isFinite(uid) || uid <= 0) return null
  return `ORD${uid}_`
}

/** 服务端生成绑定用户的商户订单号（全局唯一、不可预测） */
function generateOutTradeNo(userId) {
  const prefix = buildUserBoundOutTradeNoPrefix(userId)
  if (!prefix) return null
  const ts = Date.now().toString(36).toUpperCase()
  const rand = crypto.randomBytes(8).toString('hex').toUpperCase()
  return `${prefix}${ts}${rand}`.slice(0, 64)
}

/**
 * 解析/校验客户端传入的 out_trade_no：须以 ORD{userId}_ 开头；未传则服务端生成。
 */
function resolveUserOutTradeNo({ raw, userId }) {
  const prefix = buildUserBoundOutTradeNoPrefix(userId)
  if (!prefix) return { error: '无效的用户' }

  const trimmed = raw != null ? String(raw).trim() : ''
  if (!trimmed) {
    const outTradeNo = generateOutTradeNo(userId)
    if (!outTradeNo) return { error: '无法生成订单号' }
    return { outTradeNo, generated: true }
  }

  if (!trimmed.startsWith(prefix)) {
    return { error: '订单号须绑定当前用户（格式 ORD{用户ID}_...）' }
  }
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(trimmed)) {
    return { error: '订单号格式无效' }
  }

  return { outTradeNo: trimmed, generated: false }
}

module.exports = {
  buildUserBoundOutTradeNoPrefix,
  generateOutTradeNo,
  resolveUserOutTradeNo,
}
