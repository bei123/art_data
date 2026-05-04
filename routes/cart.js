const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/cartService');

router.get('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.getCartList(userId);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('获取购物车失败', { err: error });
    res.status(500).json({ error: '获取购物车服务暂时不可用' });
  }
});

router.post('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.addCartItem(userId, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('添加商品到购物车失败', { err: error });
    res.status(500).json({ error: '添加商品到购物车失败' });
  }
});

router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.updateCartItemQuantity(userId, req.params.id, req.body);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('更新购物车商品数量失败', { err: error });
    res.status(500).json({ error: '更新购物车商品数量失败' });
  }
});

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.deleteCartItem(userId, req.params.id);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('从购物车中删除商品失败', { err: error });
    res.status(500).json({ error: '从购物车中删除商品失败' });
  }
});

router.delete('/', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const r = await svc.clearCart(userId);
    return res.status(r.status).json(r.body);
  } catch (error) {
    logger.error('清空购物车失败', { err: error });
    res.status(500).json({ error: '清空购物车失败' });
  }
});

module.exports = router;
