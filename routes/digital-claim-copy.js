const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const { requireAdmin } = require('../auth')
const svc = require('../services/digitalClaimCopyService')

router.get('/', async (req, res) => {
  try {
    const data = await svc.getPublicDigitalClaimCopy()
    return res.json(data)
  } catch (error) {
    logger.error('getPublicDigitalClaimCopy failed', { err: error })
    return res.json({
      list_visible: false,
      sheet_guide_visible: false,
      guide_title: '',
      list_blocks: [],
      sheet_blocks: [],
    })
  }
})

router.get('/admin', ...requireAdmin, async (req, res) => {
  try {
    const data = await svc.getAdminDigitalClaimCopy()
    return res.json(data)
  } catch (error) {
    logger.error('getAdminDigitalClaimCopy failed', { err: error })
    return res.status(500).json({ error: '获取领取说明配置失败' })
  }
})

router.put('/', ...requireAdmin, async (req, res) => {
  try {
    const result = await svc.updateDigitalClaimCopy(req.body)
    return res.status(result.status).json(result.body)
  } catch (error) {
    logger.error('updateDigitalClaimCopy failed', { err: error })
    return res.status(500).json({ error: '更新领取说明配置失败' })
  }
})

module.exports = router
