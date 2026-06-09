const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { requireAdmin } = require('../auth');
const svc = require('../services/dashboardService');

router.get('/overview', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.getDashboardOverview();
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取仪表盘概览失败', { err: error });
    res.status(500).json({ error: '获取仪表盘概览失败' });
  }
});

module.exports = router;
