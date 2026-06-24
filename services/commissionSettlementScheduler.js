const logger = require('../utils/logger')
const { settlePendingCommissions } = require('./commissionService')

const POLL_MS = parseInt(process.env.COMMISSION_SETTLEMENT_POLL_MS || '300000', 10)
let schedulerTimer = null

async function runCommissionSettlementTick() {
  const result = await settlePendingCommissions({ limit: 100 })
  if (result.settled > 0) {
    logger.info('commission settlement tick', result)
  }
  return result
}

function startCommissionSettlementScheduler() {
  if (String(process.env.COMMISSION_SETTLEMENT_SCHEDULER || 'true').toLowerCase() === 'false') {
    return
  }
  if (schedulerTimer) return

  schedulerTimer = setInterval(() => {
    runCommissionSettlementTick().catch((err) => {
      logger.warn('commission settlement scheduler error', { err: err.message })
    })
  }, Math.max(60000, POLL_MS))

  setTimeout(() => {
    runCommissionSettlementTick().catch((err) => {
      logger.warn('commission settlement startup tick error', { err: err.message })
    })
  }, 15000)

  logger.info('commission settlement scheduler started', { pollMs: Math.max(60000, POLL_MS) })
}

module.exports = {
  startCommissionSettlementScheduler,
  runCommissionSettlementTick,
}
