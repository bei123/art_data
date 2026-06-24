const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const {
  listAdminCommissions,
  listAdminCommissionRules,
  updateAdminCommissionRule,
  settlePendingCommissions,
} = require('../services/commissionService')
const {
  listAdminWithdrawals,
  approveWithdrawalManually,
  processWithdrawTransfer,
} = require('../services/withdrawService')
const {
  listAdminCouponTemplates,
  createAdminCouponTemplate,
  grantCouponToUser,
  listAdminUserCoupons,
} = require('../services/referralRewardService')

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

router.get('/withdrawals', async (req, res) => {
  try {
    const data = await listAdminWithdrawals({
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 20,
      status: req.query.status || undefined,
      userId: req.query.user_id ? parseInt(req.query.user_id, 10) : undefined,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list withdrawals failed', { err: error })
    res.status(500).json({ error: '获取提现记录失败' })
  }
})

router.post('/withdrawals/:id/approve', async (req, res) => {
  try {
    const r = await approveWithdrawalManually(req.params.id)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin approve withdrawal failed', { err: error })
    res.status(500).json({ error: '确认打款失败' })
  }
})

router.post('/withdrawals/:id/retry-transfer', async (req, res) => {
  try {
    const result = await processWithdrawTransfer(req.params.id)
    return res.json({ success: Boolean(result.ok), ...result })
  } catch (error) {
    logger.error('admin retry withdrawal transfer failed', { err: error })
    res.status(500).json({ error: '重试转账失败' })
  }
})

router.get('/coupon-templates', async (req, res) => {
  try {
    const items = await listAdminCouponTemplates()
    return res.json({ items })
  } catch (error) {
    logger.error('admin list coupon templates failed', { err: error })
    res.status(500).json({ error: '获取优惠券模板失败' })
  }
})

router.post('/coupon-templates', async (req, res) => {
  try {
    const r = await createAdminCouponTemplate(req.body)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin create coupon template failed', { err: error })
    res.status(500).json({ error: '创建优惠券模板失败' })
  }
})

router.post('/coupons/grant', async (req, res) => {
  try {
    const userId = parseInt(req.body?.user_id, 10)
    if (Number.isNaN(userId) || userId <= 0) {
      return res.status(400).json({ error: '无效的用户ID' })
    }
    const r = await grantCouponToUser({
      userId,
      templateId: req.body?.template_id ? parseInt(req.body.template_id, 10) : null,
      title: req.body?.title,
      discountYuan: req.body?.discount_yuan,
      minOrderYuan: req.body?.min_order_yuan,
      validDays: req.body?.valid_days,
      source: 'admin',
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin grant coupon failed', { err: error })
    res.status(500).json({ error: '发放优惠券失败' })
  }
})

router.get('/coupons', async (req, res) => {
  try {
    const data = await listAdminUserCoupons({
      userId: req.query.user_id ? parseInt(req.query.user_id, 10) : undefined,
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 20,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list coupons failed', { err: error })
    res.status(500).json({ error: '获取优惠券记录失败' })
  }
})

module.exports = router
