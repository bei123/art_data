const logger = require('../utils/logger')
const { runReferralReconciliation } = require('./referralDashboardService')

const INTERVAL_MS = parseInt(process.env.REFERRAL_RECONCILIATION_INTERVAL_MS || '86400000', 10)
let schedulerTimer = null
let isRunning = false

async function runReferralReconciliationTick() {
  if (isRunning) {
    logger.info('referral reconciliation tick skipped (already running)')
    return { skipped: true }
  }

  isRunning = true
  try {
    return await runReferralReconciliation()
  } finally {
    isRunning = false
  }
}

function startReferralReconciliationScheduler() {
  if (String(process.env.REFERRAL_RECONCILIATION_SCHEDULER || 'true').toLowerCase() === 'false') {
    return
  }
  if (schedulerTimer) return

  const pollMs = Math.max(3600000, INTERVAL_MS)

  schedulerTimer = setInterval(() => {
    runReferralReconciliationTick().catch((err) => {
      logger.warn('referral reconciliation scheduler error', { err: err.message })
    })
  }, pollMs)

  setTimeout(() => {
    runReferralReconciliationTick().catch((err) => {
      logger.warn('referral reconciliation startup tick error', { err: err.message })
    })
  }, 60000)

  logger.info('referral reconciliation scheduler started', { pollMs })
}

module.exports = {
  startReferralReconciliationScheduler,
  runReferralReconciliationTick,
}
