function parsePositiveMinutes(raw, fallbackMinutes) {
  const parsed = parseInt(raw, 10)
  if (Number.isFinite(parsed) && parsed >= 5) return parsed
  return fallbackMinutes
}

/** 未支付订单自动关闭 / 待付款提醒截止（默认 30 分钟） */
function getUnpaidOrderDeadlineMinutes() {
  return parsePositiveMinutes(
    process.env.ORDER_UNPAID_AUTO_CLOSE_MINUTES
      ?? process.env.WX_SUBSCRIBE_PAYMENT_DEADLINE_MINUTES,
    30,
  )
}

function getPaymentDeadlineMs(createdAt, minutes = getUnpaidOrderDeadlineMinutes()) {
  const created = createdAt ? new Date(createdAt) : new Date()
  return created.getTime() + minutes * 60 * 1000
}

/** 微信支付 JSAPI time_expire（RFC3339，东八区） */
function buildWechatPayTimeExpire(minutesFromNow = getUnpaidOrderDeadlineMinutes()) {
  const mins = Math.min(Math.max(5, minutesFromNow), 7 * 24 * 60)
  const d = new Date(Date.now() + mins * 60 * 1000)
  const pad = (n) => String(n).padStart(2, '0')
  const shanghai = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))
  return `${shanghai.getFullYear()}-${pad(shanghai.getMonth() + 1)}-${pad(shanghai.getDate())}T${pad(shanghai.getHours())}:${pad(shanghai.getMinutes())}:${pad(shanghai.getSeconds())}+08:00`
}

module.exports = {
  getUnpaidOrderDeadlineMinutes,
  getPaymentDeadlineMs,
  buildWechatPayTimeExpire,
}
