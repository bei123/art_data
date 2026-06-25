const express = require('express')
const router = express.Router()
const logger = require('../utils/logger')
const { requireAdmin } = require('../auth')
const {
  listWxUsersForAdmin,
  getWxUserAdminDetail,
  purgeWxUser,
} = require('../services/wxUserAdminService')

router.use(...requireAdmin)

router.get('/', async (req, res) => {
  try {
    const { page, pageSize, keyword } = req.query
    const data = await listWxUsersForAdmin({
      page: parseInt(page, 10) || 1,
      pageSize: parseInt(pageSize, 10) || 20,
      keyword: keyword || undefined,
    })
    return res.json(data)
  } catch (error) {
    logger.error('admin list wx users failed', { err: error })
    return res.status(500).json({ error: '获取用户列表失败' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const result = await getWxUserAdminDetail(req.params.id)
    return res.status(result.status).json(result.body)
  } catch (error) {
    logger.error('admin get wx user detail failed', { err: error })
    return res.status(500).json({ error: '获取用户详情失败' })
  }
})

router.post('/:id/purge', async (req, res) => {
  try {
    const result = await purgeWxUser({
      userId: req.params.id,
      confirmUserId: req.body?.confirm_user_id,
      confirmPhrase: req.body?.confirm_phrase,
      adminUserId: req.user?.id,
    })
    return res.status(result.status).json(result.body)
  } catch (error) {
    logger.error('admin purge wx user failed', { err: error })
    return res.status(500).json({ error: '注销用户失败' })
  }
})

module.exports = router
