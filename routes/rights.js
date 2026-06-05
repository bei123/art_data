const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken, optionalAuthenticate } = require('../auth');
const svc = require('../services/rightsService');

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicRightsList(req.query);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取版权实物列表失败', { err: error });
    res.status(500).json({ error: '获取版权实物列表服务暂时不可用' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const r = await svc.createRightAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('创建版权实物失败', { err: error });
    res.status(500).json({ error: '创建版权实物失败' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.updateRightAdmin(req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新版权实物失败', { err: error });
    res.status(500).json({ error: '更新版权实物失败' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.deleteRightAdmin(req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('删除版权实物失败', { err: error });
    res.status(500).json({ error: '删除版权实物失败' });
  }
});

router.get('/:id', optionalAuthenticate, async (req, res) => {
  try {
    const userId = req.user?.id ?? null;
    const r = await svc.getPublicRightDetail(req.params.id, userId);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取版权实物详情失败', { err: error });
    res.status(500).json({ error: '获取版权实物详情失败' });
  }
});

module.exports = router;
