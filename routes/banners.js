const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/bannersService');

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicBannersList();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取轮播图列表失败', { err: error });
    res.status(500).json({ error: '获取轮播图列表服务暂时不可用' });
  }
});

router.get('/all', authenticateToken, async (req, res) => {
  try {
    const r = await svc.getAllBannersAdmin();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取所有轮播图失败', { err: error });
    res.status(500).json({ error: '获取所有轮播图服务暂时不可用' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const r = await svc.createBannerAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('添加轮播图失败', { err: error });
    res.status(500).json({ error: '添加轮播图服务暂时不可用' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.updateBannerAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新轮播图失败', { err: error });
    res.status(500).json({ error: '更新轮播图服务暂时不可用' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.deleteBannerAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('删除轮播图失败', { err: error });
    res.status(500).json({ error: '删除轮播图服务暂时不可用' });
  }
});

module.exports = router;
