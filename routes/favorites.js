const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/favoritesService');

router.use(async (req, res, next) => {
  try {
    await svc.ensureFavoritesSchema();
    next();
  } catch (e) {
    next(e);
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.getFavoritesList(userId, req.query);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取收藏列表失败', { err: error });
    res.status(500).json({ error: '服务器错误' });
  }
});

/** 单条收藏状态（避免为判断一个商品是否收藏而拉全量列表） */
router.get('/:itemType/:itemId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.getFavoriteStatus(userId, req.params.itemType, req.params.itemId);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('查询收藏状态失败', { err: error });
    res.status(500).json({ error: '查询收藏状态失败' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.addFavorite(userId, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('添加收藏失败', { err: error });
    res.status(500).json({ error: '添加收藏服务暂时不可用' });
  }
});

router.delete('/:itemType/:itemId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.removeFavorite(userId, req.params.itemType, req.params.itemId);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('取消收藏失败', { err: error });
    res.status(500).json({ error: '取消收藏服务暂时不可用' });
  }
});

module.exports = router;
module.exports.ensureFavoritesSchema = svc.ensureFavoritesSchema;
