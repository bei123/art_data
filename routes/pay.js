const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken } = require('../auth');
const svc = require('../services/payService');

router.post('/unifiedorder', authenticateToken, async (req, res) => {
  try {
    const r = await svc.unifiedOrder(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('统一下单失败', { err: e });
    return res.status(500).json({ error: '统一下单失败' });
  }
});

router.post('/singleorder', authenticateToken, async (req, res) => {
  try {
    const r = await svc.singleOrder(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('单商品下单失败', { err: e });
    return res.status(500).json({ error: '单商品下单失败' });
  }
});

router.post('/notify', async (req, res) => {
  try {
    const r = await svc.payNotify(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('支付回调处理失败', { err: e });
    return res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
});

router.post('/close', authenticateToken, async (req, res) => {
  try {
    const r = await svc.closeOrder(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('关闭订单失败', { err: e });
    return res.status(500).json({ success: false, error: '关闭订单失败' });
  }
});

router.post('/refund', authenticateToken, async (req, res) => {
  try {
    const r = await svc.refund(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('申请退款失败', { err: e });
    return res.status(500).json({ success: false, error: '申请退款失败' });
  }
});

router.post('/refund/approve', authenticateToken, async (req, res) => {
  try {
    const r = await svc.refundApprove(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('处理退款申请失败', { err: e });
    return res.status(500).json({ success: false, error: '处理退款申请失败' });
  }
});

router.get('/refund/requests', authenticateToken, async (req, res) => {
  try {
    const r = await svc.listRefundRequests(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('获取退款申请列表失败', { err: e });
    return res.status(500).json({ success: false, error: '获取退款申请列表失败' });
  }
});

router.get('/refund/requests/:id', authenticateToken, async (req, res) => {
  try {
    const r = await svc.getRefundRequestById(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('获取退款申请详情失败', { err: e });
    return res.status(500).json({ success: false, error: '获取退款申请详情失败' });
  }
});

router.post('/refund/notify', async (req, res) => {
  try {
    const r = await svc.refundNotify(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('退款回调处理失败', { err: e });
    return res.status(500).json({ code: 'FAIL', message: '处理失败' });
  }
});

router.post('/sign', authenticateToken, async (req, res) => {
  try {
    const r = await svc.signPay(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('生成支付签名失败', { err: e });
    return res.status(500).json({ error: '生成支付签名失败' });
  }
});

router.get('/query', authenticateToken, async (req, res) => {
  try {
    const r = await svc.queryOrder(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('查询订单失败', { err: e });
    return res.status(500).json({ success: false, error: '查询订单失败' });
  }
});

router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const r = await svc.listOrders(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('查询订单列表失败', { err: e });
    return res.status(500).json({ success: false, error: '查询订单列表失败' });
  }
});

router.get('/digital-identity/purchases/:user_id', async (req, res) => {
  try {
    const r = await svc.digitalIdentityPurchases(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('获取数字身份购买记录失败', { err: e });
    return res.status(500).json({ error: '获取数字身份购买记录失败' });
  }
});

router.get('/admin/orders', authenticateToken, async (req, res) => {
  try {
    const r = await svc.adminOrders(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('管理员查询订单列表失败', { err: e });
    return res.status(500).json({ success: false, error: '管理员查询订单列表失败' });
  }
});

router.get('/check-repayable', authenticateToken, async (req, res) => {
  try {
    const r = await svc.checkRepayable(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('检查订单重复支付状态失败', { err: e });
    return res.status(500).json({ success: false, error: '检查订单重复支付状态失败' });
  }
});

module.exports = router;
