const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const {
  listAdminCommissions,
  listAdminCommissionRules,
  updateAdminCommissionRule,
  settlePendingCommissions,
} = require('../services/commissionService')

router.get('/commissions', async (req, res) => {
  try {
    const { page, pageSize, status, user_id: userId, out_trade_no: outTradeNo } = req.query
    const data = await listAdminCommissions({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      status: status || undefined,
      userId: userId ? parseInt(userId, 10) : undefined,
      outTradeNo: outTradeNo || undefined,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list commissions failed', { err: error })
    res.status(500).json({ error: '获取佣金明细失败' })
  }
})

router.get('/commission-rules', async (req, res) => {
  try {
    const items = await listAdminCommissionRules()
    return res.json({ items })
  } catch (error) {
    logger.error('admin list commission rules failed', { err: error })
    res.status(500).json({ error: '获取佣金规则失败' })
  }
})

router.put('/commission-rules/:id', async (req, res) => {
  try {
    const r = await updateAdminCommissionRule(req.params.id, req.body)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin update commission rule failed', { err: error })
    res.status(500).json({ error: '更新佣金规则失败' })
  }
})

router.post('/commissions/settle-run', async (req, res) => {
  try {
    const result = await settlePendingCommissions({
      limit: parseInt(req.body?.limit, 10) || 100,
    })
    return res.json({ success: true, ...result })
  } catch (error) {
    logger.error('admin manual commission settle failed', { err: error })
    res.status(500).json({ error: '执行结算失败' })
  }
})

module.exports = router
