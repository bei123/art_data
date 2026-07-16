const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const { authenticateToken } = require('../auth')
const svc = require('../services/referralService')

router.use(async (req, res, next) => {
  try {
    const { ensureReferralSchema } = require('../utils/referralSchema')
    await ensureReferralSchema()
    next()
  } catch (err) {
    next(err)
  }
})

router.post('/bind', authenticateToken, async (req, res) => {
  try {
    const r = await svc.bindReferralFromRequest(req)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('绑定推荐关系失败', { err: error })
    res.status(500).json({ error: '绑定推荐关系失败' })
  }
})

router.get('/code', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const r = await svc.getReferralCodeInfo(session.userId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取推荐码失败', { err: error })
    res.status(500).json({ error: '获取推荐码失败' })
  }
})

router.get('/center', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const r = await svc.getReferralCenter(session.userId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取推荐官中心失败', { err: error })
    res.status(500).json({ error: '获取推荐官中心失败' })
  }
})

router.get('/tier', authenticateToken, async (req, res) => {
  try {
    const r = await svc.getTierForRequest(req)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取用户等级失败', { err: error })
    res.status(500).json({ error: '获取用户等级失败' })
  }
})

router.post('/share-event', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const r = await svc.recordShareEvent(session.userId, req.body)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('记录分享失败', { err: error })
    res.status(500).json({ error: '记录分享失败' })
  }
})

router.get('/commissions', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { listUserCommissions } = require('../services/commissionService')
    const { page, pageSize, status } = req.query
    const data = await listUserCommissions(session.userId, {
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      status: status || undefined,
    })
    return res.json(data)
  } catch (error) {
    logger.error('获取佣金明细失败', { err: error })
    res.status(500).json({ error: '获取佣金明细失败' })
  }
})

router.post('/withdraw/notify', async (req, res) => {
  try {
    const { handleTransferNotify } = require('../services/withdrawService')
    const result = await handleTransferNotify(req)
    if (result.noContent) {
      return res.status(result.status).end()
    }
    return res.status(result.status).json(result.body)
  } catch (error) {
    logger.error('商家转账回调处理失败', { err: error })
    return res.status(500).json({ code: 'FAIL', message: '处理失败' })
  }
})

router.post('/withdraw', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { requestWithdraw } = require('../services/withdrawService')
    const { amount_yuan: amountYuan, withdraw_all: withdrawAll } = req.body || {}
    const r = await requestWithdraw(session.userId, {
      amountYuan,
      withdrawAll: withdrawAll === true || withdrawAll === 1 || withdrawAll === '1',
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('提现申请失败', { err: error })
    res.status(500).json({ error: '提现申请失败' })
  }
})

router.get('/withdrawals', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { listUserWithdrawals } = require('../services/withdrawService')
    const data = await listUserWithdrawals(session.userId, {
      page: parseInt(req.query.page, 10) || 1,
      pageSize: parseInt(req.query.pageSize, 10) || 20,
    })
    return res.json(data)
  } catch (error) {
    logger.error('获取提现记录失败', { err: error })
    res.status(500).json({ error: '获取提现记录失败' })
  }
})

router.get('/withdrawals/:id/confirm-info', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const withdrawalId = parseInt(req.params.id, 10)
    if (!Number.isFinite(withdrawalId) || withdrawalId <= 0) {
      return res.status(400).json({ error: '无效的提现记录' })
    }

    const { getWithdrawalConfirmInfo } = require('../services/withdrawService')
    const r = await getWithdrawalConfirmInfo(session.userId, withdrawalId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取提现确认信息失败', { err: error })
    res.status(500).json({ error: '获取提现确认信息失败' })
  }
})

router.post('/withdrawals/:id/sync', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const withdrawalId = parseInt(req.params.id, 10)
    if (!Number.isFinite(withdrawalId) || withdrawalId <= 0) {
      return res.status(400).json({ error: '无效的提现记录' })
    }

    const { syncWithdrawalFromWechat } = require('../services/withdrawService')
    const r = await syncWithdrawalFromWechat(withdrawalId, { userId: session.userId })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('同步提现状态失败', { err: error })
    res.status(500).json({ error: '同步提现状态失败' })
  }
})

router.get('/rules', async (req, res) => {
  try {
    const r = await svc.getReferralRules()
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取推荐规则失败', { err: error })
    res.status(500).json({ error: '获取推荐规则失败' })
  }
})

router.post('/advisor/apply', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { submitArtAdvisorApplication } = require('../services/artAdvisorService')
    const r = await submitArtAdvisorApplication(session.userId, req.body)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('艺术顾问申请失败', { err: error })
    res.status(500).json({ error: '艺术顾问申请失败' })
  }
})

router.get('/advisor/status', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { getArtAdvisorApplicationStatus } = require('../services/artAdvisorService')
    const r = await getArtAdvisorApplicationStatus(session.userId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取艺术顾问状态失败', { err: error })
    res.status(500).json({ error: '获取艺术顾问状态失败' })
  }
})

router.get('/coupons', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { listUserCoupons } = require('../services/referralRewardService')
    const syncRaw = String(req.query.sync ?? '1').toLowerCase()
    const forceRaw = String(req.query.force ?? '').toLowerCase()
    const items = await listUserCoupons(session.userId, {
      status: req.query.status || 'available',
      sync: syncRaw !== '0' && syncRaw !== 'false',
      force: forceRaw === '1' || forceRaw === 'true',
    })
    return res.json({ items })
  } catch (error) {
    logger.error('获取优惠券失败', { err: error })
    res.status(500).json({ error: '获取优惠券失败' })
  }
})

router.get('/coupons/:id/card-ext', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const couponId = parseInt(req.params.id, 10)
    if (!Number.isFinite(couponId) || couponId <= 0) {
      return res.status(400).json({ error: '无效的优惠券 ID' })
    }

    const { getCouponCardExtForUser } = require('../services/wxCardService')
    const r = await getCouponCardExtForUser(session.userId, couponId)
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('获取 card-ext 失败', { err: error })
    res.status(500).json({ error: '获取放入卡包参数失败' })
  }
})

router.post('/coupons/:id/card-added', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const couponId = parseInt(req.params.id, 10)
    if (!Number.isFinite(couponId) || couponId <= 0) {
      return res.status(400).json({ error: '无效的优惠券 ID' })
    }

    const { markCouponCardAdded } = require('../services/wxCardService')
    const r = await markCouponCardAdded({
      userId: session.userId,
      couponId,
      encryptCode: req.body?.code || req.body?.encrypt_code || '',
      cardId: req.body?.card_id || req.body?.cardId || '',
      isSuccess: req.body?.is_success !== false && req.body?.isSuccess !== false,
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('上报卡券领取结果失败', { err: error })
    res.status(500).json({ error: '上报卡券领取结果失败' })
  }
})

router.post('/coupons/from-card', authenticateToken, async (req, res) => {
  try {
    const session = await svc.resolveWxUserId(req)
    if (!session.ok) return res.status(session.result.status).json(session.result.body)

    const { resolveCouponFromCardJump } = require('../services/wxCardService')
    const r = await resolveCouponFromCardJump({
      userId: session.userId,
      encryptCode: req.body?.encrypt_code || req.body?.encryptCode || '',
      cardId: req.body?.card_id || req.body?.cardId || '',
      oaOpenid: req.body?.openid || req.body?.oa_openid || '',
    })
    return res.status(r.status).json(r.body)
  } catch (error) {
    logger.error('卡面跳转对齐优惠券失败', { err: error })
    const status = error.code === 'WX_CODE_DECRYPT_FAILED' ? 502 : 500
    res.status(status).json({ error: error.message || '对齐优惠券失败' })
  }
})

module.exports = router
