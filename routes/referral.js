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

module.exports = router
