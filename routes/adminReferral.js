const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const { requireAdmin } = require('../auth')

router.use(...requireAdmin)
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
  startAdminCouponTemplate,
  pauseAdminCouponTemplate,
  restartAdminCouponTemplate,
  listAdminWxFavorStocks,
  getAdminWxFavorStock,
  listAdminWxFavorStockMerchants,
  listAdminWxFavorStockItems,
  syncAdminCouponTemplatesFromWx,
  getAdminFavorCallback,
  setAdminFavorCallback,
  grantCouponToUser,
  grantCouponToUsersBatch,
  getFavorGrantEligibleCount,
  listAdminUserCoupons,
  getAdminUserCouponDetail,
} = require('../services/referralRewardService')
const {
  listAdminArtAdvisorApplications,
  approveArtAdvisorApplication,
  rejectArtAdvisorApplication,
} = require('../services/artAdvisorService')
const {
  setProductVipEarlyAccess,
  getProductVipEarlyAccess,
} = require('../services/vipEarlyAccessService')
const {
  listAdminShareEvents,
  runReferralReconciliation,
  listReconciliationLogs,
  getReconciliationLogById,
} = require('../services/referralDashboardService')

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

router.get('/wx-stocks', async (req, res) => {
  try {
    const r = await listAdminWxFavorStocks(req.query)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin list wx favor stocks failed', { err: error })
    res.status(500).json({ error: '查询微信批次失败' })
  }
})

router.get('/wx-stocks/:stockId/merchants', async (req, res) => {
  try {
    const r = await listAdminWxFavorStockMerchants(req.params.stockId, req.query)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin list wx favor stock merchants failed', { err: error })
    res.status(500).json({ error: '查询可用商户失败' })
  }
})

router.get('/wx-stocks/:stockId/items', async (req, res) => {
  try {
    const r = await listAdminWxFavorStockItems(req.params.stockId, req.query)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin list wx favor stock items failed', { err: error })
    res.status(500).json({ error: '查询可用商品编码失败' })
  }
})

router.get('/wx-stocks/:stockId', async (req, res) => {
  try {
    const r = await getAdminWxFavorStock(req.params.stockId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin get wx favor stock failed', { err: error })
    res.status(500).json({ error: '查询批次详情失败' })
  }
})

router.get('/favor-callback', async (req, res) => {
  try {
    const r = await getAdminFavorCallback()
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin get favor callback failed', { err: error })
    res.status(500).json({ error: '查询营销回调地址失败' })
  }
})

router.post('/favor-callback', async (req, res) => {
  try {
    const r = await setAdminFavorCallback(req.body || {})
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin set favor callback failed', { err: error })
    res.status(500).json({ error: '设置营销回调地址失败' })
  }
})

router.post('/coupon-templates/sync-wx', async (req, res) => {
  try {
    const r = await syncAdminCouponTemplatesFromWx()
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin sync coupon templates from wx failed', { err: error })
    res.status(500).json({ error: '同步微信批次状态失败' })
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

router.post('/coupon-templates/:id/start', async (req, res) => {
  try {
    const r = await startAdminCouponTemplate(req.params.id)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin start coupon template failed', { err: error })
    res.status(500).json({ error: '激活优惠券批次失败' })
  }
})

router.post('/coupon-templates/:id/pause', async (req, res) => {
  try {
    const r = await pauseAdminCouponTemplate(req.params.id)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin pause coupon template failed', { err: error })
    res.status(500).json({ error: '暂停优惠券批次失败' })
  }
})

router.post('/coupon-templates/:id/restart', async (req, res) => {
  try {
    const r = await restartAdminCouponTemplate(req.params.id)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin restart coupon template failed', { err: error })
    res.status(500).json({ error: '重启优惠券批次失败' })
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
      source: 'admin',
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin grant coupon failed', { err: error })
    res.status(500).json({ error: '发放优惠券失败' })
  }
})

router.post('/coupons/grant-batch', async (req, res) => {
  try {
    const r = await grantCouponToUsersBatch({
      userIds: req.body?.user_ids,
      userIdsText: req.body?.user_ids_text || req.body?.users_text,
      templateId: req.body?.template_id ? parseInt(req.body.template_id, 10) : null,
      grantAll: req.body?.grant_all,
      confirmGrantAll: req.body?.confirm_grant_all,
      source: 'admin',
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin batch grant coupon failed', { err: error })
    res.status(500).json({ error: '批量发放优惠券失败' })
  }
})

router.get('/coupons/grant-eligible-count', async (req, res) => {
  try {
    const r = await getFavorGrantEligibleCount()
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin grant eligible count failed', { err: error })
    res.status(500).json({ error: '查询可发放用户数失败' })
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

router.get('/coupons/:couponId', async (req, res) => {
  try {
    const r = await getAdminUserCouponDetail(req.query.user_id, req.params.couponId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin get coupon detail failed', { err: error })
    res.status(500).json({ error: '查询券详情失败' })
  }
})

router.get('/advisor-applications', async (req, res) => {
  try {
    const data = await listAdminArtAdvisorApplications({
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 20,
      status: req.query.status || undefined,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list advisor applications failed', { err: error })
    res.status(500).json({ error: '获取艺术顾问申请失败' })
  }
})

router.post('/advisor-applications/:id/approve', async (req, res) => {
  try {
    const rate = req.body?.commission_rate
    const r = await approveArtAdvisorApplication(req.params.id, {
      commissionRate: rate,
      reviewedBy: req.user?.id,
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin approve advisor failed', { err: error })
    res.status(500).json({ error: '审批失败' })
  }
})

router.post('/advisor-applications/:id/reject', async (req, res) => {
  try {
    const r = await rejectArtAdvisorApplication(req.params.id, {
      reason: req.body?.reason,
      reviewedBy: req.user?.id,
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin reject advisor failed', { err: error })
    res.status(500).json({ error: '驳回失败' })
  }
})

router.get('/vip-early-access', async (req, res) => {
  try {
    const r = await getProductVipEarlyAccess(req.query.product_type, req.query.product_id)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin get vip early access failed', { err: error })
    res.status(500).json({ error: '查询失败' })
  }
})

router.put('/vip-early-access', async (req, res) => {
  try {
    const r = await setProductVipEarlyAccess({
      productType: req.body?.product_type,
      productId: req.body?.product_id,
      enabled: req.body?.vip_early_access,
      until: req.body?.vip_early_until,
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin set vip early access failed', { err: error })
    res.status(500).json({ error: '设置失败' })
  }
})

router.get('/share-events', async (req, res) => {
  try {
    const data = await listAdminShareEvents({
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 20,
      userId: req.query.user_id ? parseInt(req.query.user_id, 10) : undefined,
      itemType: req.query.item_type || undefined,
      channel: req.query.channel || undefined,
      dateFrom: req.query.date_from || undefined,
      dateTo: req.query.date_to || undefined,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list share events failed', { err: error })
    res.status(500).json({ error: '获取分享记录失败' })
  }
})

router.post('/reconciliation/run', async (req, res) => {
  try {
    const result = await runReferralReconciliation()
    return res.json({ success: true, ...result })
  } catch (error) {
    logger.error('admin run reconciliation failed', { err: error })
    res.status(500).json({ error: '执行对账失败' })
  }
})

router.get('/reconciliation/logs', async (req, res) => {
  try {
    const data = await listReconciliationLogs({
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 20,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list reconciliation logs failed', { err: error })
    res.status(500).json({ error: '获取对账记录失败' })
  }
})

router.get('/reconciliation/logs/:id', async (req, res) => {
  try {
    const r = await getReconciliationLogById(req.params.id)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('admin get reconciliation log failed', { err: error })
    res.status(500).json({ error: '获取对账详情失败' })
  }
})

module.exports = router
