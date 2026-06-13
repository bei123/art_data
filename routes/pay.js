const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { authenticateToken, assertSelfOrAdmin, requireAdmin } = require('../auth');
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

router.post('/refund/approve', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.refundApprove(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('处理退款申请失败', { err: e });
    return res.status(500).json({ success: false, error: '处理退款申请失败' });
  }
});

router.get('/refund/requests', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.listRefundRequests(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('获取退款申请列表失败', { err: e });
    return res.status(500).json({ success: false, error: '获取退款申请列表失败' });
  }
});

router.get('/refund/requests/:id', ...requireAdmin, async (req, res) => {
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

/** 小程序/用户：本人订单详情；须传商户订单号 ?out_trade_no=；可选 ?include_wechat_path=1 拉微信轨迹 */
router.get('/orders/detail', authenticateToken, async (req, res) => {
  try {
    const r = await svc.buyerOrderDetail(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('用户查询订单详情失败', { err: e });
    return res.status(500).json({ success: false, error: '查询订单详情失败' });
  }
});

/** 小程序订单列表：JWT 识别用户，支持 status 分页 */
router.get('/orders', authenticateToken, async (req, res) => {
  try {
    const r = await svc.listOrders(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('查询订单列表失败', { err: e });
    return res.status(500).json({ success: false, error: '查询订单列表失败' });
  }
});

router.get('/digital-identity/purchases/:user_id', authenticateToken, async (req, res) => {
  try {
    const access = await assertSelfOrAdmin(req, req.params.user_id);
    if (!access.ok) {
      return res.status(access.status).json({ error: access.error });
    }
    const r = await svc.digitalIdentityPurchases(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('获取数字身份购买记录失败', { err: e });
    return res.status(500).json({ error: '获取数字身份购买记录失败' });
  }
});

router.get('/admin/orders', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.adminOrders(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('管理员查询订单列表失败', { err: e });
    return res.status(500).json({ success: false, error: '管理员查询订单列表失败' });
  }
});

/** 管理端：对已支付订单发起退款（创建退款单并提交微信） */
router.post('/admin/orders/:id/refund', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.adminOrderRefund(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('管理端发起退款失败', { err: e });
    return res.status(500).json({ success: false, error: '发起退款失败' });
  }
});

/** 管理端订单详情（费用分项、支付脱敏、时间轴、退款、履约、业务 ID、shipments；?include_wechat_path=1 时顺带调微信 getPath） */
router.get('/admin/orders/:id', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.adminOrderDetail(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('管理员查询订单详情失败', { err: e });
    return res.status(500).json({ success: false, error: '管理员查询订单详情失败' });
  }
});

/** 管理端：为已支付数字艺术品订单项上传交付二维码 */
router.patch('/admin/orders/:orderId/items/:itemId/qr-code', ...requireAdmin, async (req, res) => {
  try {
    const r = await svc.uploadDigitalItemQrCode(req);
    return res.status(r.status).json(r.body);
  } catch (e) {
    logger.error('上传数字艺术品交付二维码失败', { err: e });
    return res.status(500).json({ success: false, error: '上传二维码失败' });
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
