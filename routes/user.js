const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/userService');

router.get('/purchased', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.getPurchasedProducts(userId);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取已购产品失败', { err: error });
    res.status(500).json({ error: '获取已购产品失败' });
  }
});

module.exports = router;
