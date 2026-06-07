const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { requireAdmin } = require('../auth');
const svc = require('../services/showcaseService');

router.use(async (req, res, next) => {
  try {
    await svc.ensureShowcaseSchemaReady();
    next();
  } catch (e) {
    next(e);
  }
});

router.get('/', async (req, res) => {
  try {
    const r = await svc.getPublicShowcaseList();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取展示列表失败', { err: error });
    res.status(500).json({ error: '获取展示列表失败' });
  }
});

router.get('/admin-order', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.getShowcaseForSortAdmin();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取展示排序列表失败', { err: error });
    res.status(500).json({ error: '获取展示排序列表失败' });
  }
});

router.put('/sort', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.reorderShowcaseAdmin(req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新展示顺序失败', { err: error });
    res.status(500).json({ error: '更新展示顺序失败' });
  }
});

module.exports = router;
