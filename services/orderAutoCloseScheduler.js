const logger = require('../utils/logger')
const { getUnpaidOrderDeadlineMinutes } = require('../utils/orderPaymentDeadline')
const { closeExpiredUnpaidOrders } = require('./payService')

const POLL_MS = parseInt(process.env.ORDER_UNPAID_AUTO_CLOSE_POLL_MS || '60000', 10)
let schedulerTimer = null
let isTickRunning = false

async function runOrderAutoCloseTick() {
  if (isTickRunning) {
    return { skipped: true, closed: 0, scanned: 0 }
  }

  isTickRunning = true
  try {
    return await closeExpiredUnpaidOrders({ limit: 50 })
  } finally {
    isTickRunning = false
  }
}

function startOrderAutoCloseScheduler() {
  if (String(process.env.ORDER_UNPAID_AUTO_CLOSE_SCHEDULER || 'true').toLowerCase() === 'false') {
    return
  }
  if (schedulerTimer) return

  const pollMs = Math.max(30000, POLL_MS)
  schedulerTimer = setInterval(() => {
    runOrderAutoCloseTick().catch((err) => {
      logger.warn('order_auto_close_scheduler_error', { err: err?.message || err })
    })
  }, pollMs)

  setTimeout(() => {
    runOrderAutoCloseTick().catch((err) => {
      logger.warn('order_auto_close_startup_tick_error', { err: err?.message || err })
    })
  }, 20000)

  logger.info('order_auto_close_scheduler_started', {
    pollMs,
    deadlineMinutes: getUnpaidOrderDeadlineMinutes(),
  })
}

module.exports = {
  startOrderAutoCloseScheduler,
  runOrderAutoCloseTick,
}
